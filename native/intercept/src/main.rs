//! The native front of `memnox-intercept`: the daemon rules, this runs, and every doubt runs Node.

mod json;
mod protocol;

use std::collections::HashSet;
use std::env;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{self, Command};
use std::time::Duration;

use protocol::{InterceptLine, Plan};

/// The Node interceptor, found on PATH as the shim found it; this is never named after it.
const NODE_INTERCEPTOR: &str = "memnox-intercept";

/// `MEMNOX_HOME` in core: the home's own folder, which holds the socket and the shims.
const MEMNOX_HOME: &str = ".memnox";

/// `SOCKET_FILE` in core.
const SOCKET_FILE: &str = "memnox.sock";

/// `INTERCEPTOR_DIR` in core, where the shims live and nothing real ever does.
const INTERCEPTOR_DIR: &str = "bin";

/// `off` sends every command to Node, for comparing the two paths on one machine.
const SWITCH: &str = "MEMNOX_INTERCEPT_NATIVE";

/// The daemon plans from files it reads fresh, so a few milliseconds is normal and this is not.
const PLAN_TIMEOUT: Duration = Duration::from_millis(150);

/// Waited for after the command, so the row lands before the agent's next command.
const REPORT_TIMEOUT: Duration = Duration::from_millis(1000);

/// An answer far longer than this is not the daemon.
const MOST_ANSWER_BYTES: u64 = 1 << 20;

/// Node's own word for a command that failed or was signalled.
const FAILED: i32 = 1;

const SIGINT: i32 = 2;
const SIGQUIT: i32 = 3;

extern "C" {
    fn signal(signum: i32, handler: usize) -> usize;
}

/// Caught rather than ignored, because an ignored signal stays ignored in the child after exec.
extern "C" fn let_the_command_answer(_: i32) {}

fn main() {
    let args: Vec<OsString> = env::args_os().collect();
    let forwarded: Vec<OsString> = args.iter().skip(1).cloned().collect();
    // A panic is a doubt like any other, and a doubt runs Node.
    let outcome = std::panic::catch_unwind(|| fast(&args));
    match outcome {
        Ok(Some(code)) => process::exit(code),
        _ => run_node(&forwarded),
    }
}

/// The exit code once this handled the command, or None when Node has to.
fn fast(args: &[OsString]) -> Option<i32> {
    if env::var_os(SWITCH).is_some_and(|value| value == "off") {
        return None;
    }
    let argv: Vec<String> = args
        .iter()
        .skip(1)
        .map(|each| each.clone().into_string().ok())
        .collect::<Option<_>>()?;
    let binary = argv.first()?;
    if file_name(binary).starts_with(NODE_INTERCEPTOR) {
        return None;
    }
    let env_pairs = environment()?;
    let home = env::var("HOME").ok().filter(|home| !home.is_empty())?;
    let cwd = env::current_dir().ok()?.into_os_string().into_string().ok()?;
    let line = protocol::intercept_line(&InterceptLine {
        argv: &argv,
        env: &env_pairs,
        cwd: &cwd,
        ppid: std::os::unix::process::parent_id(),
    });

    let socket = Path::new(&home).join(MEMNOX_HOME).join(SOCKET_FILE);
    let mut stream = UnixStream::connect(socket).ok()?;
    stream.set_read_timeout(Some(PLAN_TIMEOUT)).ok()?;
    stream.set_write_timeout(Some(PLAN_TIMEOUT)).ok()?;
    stream.write_all(line.as_bytes()).ok()?;
    let mut reader = BufReader::new(stream.try_clone().ok()?.take(MOST_ANSWER_BYTES));
    let answer = read_line(&mut reader)?;

    match protocol::plan_of(&answer) {
        Plan::Node => None,
        Plan::Pass { real, path } => {
            let real = runnable(&real, &home)?;
            Some(run(&real, &argv[1..], &path))
        }
        Plan::Refuse { notes, exit_code } => {
            say(&notes);
            // Best effort: the refusal stands whether or not the row could be asked for.
            let _ = stream.write_all(protocol::acted_line().as_bytes());
            Some(exit_code)
        }
        Plan::Run { real, path, notes } => {
            let real = runnable(&real, &home)?;
            say(&notes);
            // Past this line the command is ours to run, so nothing below falls back to Node.
            let _ = stream.write_all(protocol::acted_line().as_bytes());
            let code = run(&real, &argv[1..], &path);
            report(&mut stream, &mut reader, code);
            Some(code)
        }
    }
}

/// Every variable as UTF-8 and named once, or None, since Node would read either differently.
fn environment() -> Option<Vec<(String, String)>> {
    let mut seen = HashSet::new();
    let mut pairs = Vec::new();
    for (name, value) in env::vars_os() {
        let name = name.into_string().ok()?;
        let value = value.into_string().ok()?;
        if !seen.insert(name.clone()) {
            return None;
        }
        pairs.push((name, value));
    }
    Some(pairs)
}

fn read_line(reader: &mut impl BufRead) -> Option<String> {
    let mut answer = String::new();
    let read = reader.read_line(&mut answer).ok()?;
    if read == 0 || !answer.ends_with('\n') {
        return None;
    }
    Some(answer.trim_end().to_owned())
}

fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// The daemon's answer checked again: never ourselves, never a shim, which would be the fork bomb.
fn runnable(real: &str, home: &str) -> Option<String> {
    let path = Path::new(real);
    if !path.is_absolute() || file_name(real).starts_with(NODE_INTERCEPTOR) {
        return None;
    }
    let parent = path.parent()?;
    let shims = Path::new(home).join(MEMNOX_HOME).join(INTERCEPTOR_DIR);
    let any_home_shims = parent.ends_with(Path::new(MEMNOX_HOME).join(INTERCEPTOR_DIR));
    if parent == shims || any_home_shims {
        return None;
    }
    Some(real.to_owned())
}

/// Stdio untouched and the exit code passed back, as the Node interceptor's `hand` does.
fn run(real: &str, args: &[String], path: &str) -> i32 {
    // SAFETY: a handler that does nothing is async signal safe, and this process only waits.
    unsafe {
        let handler = let_the_command_answer as extern "C" fn(i32) as usize;
        signal(SIGINT, handler);
        signal(SIGQUIT, handler);
    }
    match Command::new(real).args(args).env("PATH", path).status() {
        Ok(status) => status.code().unwrap_or(FAILED),
        Err(_) => FAILED,
    }
}

/// How it ended, and any pause the breaker called because of it, printed as Node prints it.
fn report(stream: &mut UnixStream, reader: &mut impl BufRead, code: i32) {
    if stream.set_read_timeout(Some(REPORT_TIMEOUT)).is_err() {
        return;
    }
    if stream.write_all(protocol::ran_line(code).as_bytes()).is_err() {
        return;
    }
    let Some(answer) = read_line(reader) else { return };
    let Some(value) = json::parse(&answer) else { return };
    if value.field("id").and_then(json::Value::integer) != Some(protocol::RAN_ID) {
        return;
    }
    if let Some(notes) = protocol::notes_of(&value) {
        say(&notes);
    }
}

fn say(notes: &[String]) {
    let mut err = std::io::stderr().lock();
    for note in notes {
        let _ = writeln!(err, "{note}");
    }
}

/// The Node interceptor with the same argv, which always knows what to do.
fn run_node(forwarded: &[OsString]) -> ! {
    let error = Command::new(NODE_INTERCEPTOR).args(forwarded).exec();
    eprintln!("memnox: could not start {NODE_INTERCEPTOR}: {error}");
    process::exit(127);
}
