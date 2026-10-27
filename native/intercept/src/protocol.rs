//! The lines this client and the daemon exchange, pinned by `fixtures/` against the TypeScript side.

use crate::json::{self, Value};

/// `FAST_INTERCEPT_VERSION` in `packages/core/src/daemon/intercept.ts`; a mismatch is a doubt.
pub const VERSION: i64 = 1;

/// The one id the plan is asked under, so the answer can be matched to it.
pub const PLAN_ID: i64 = 1;
pub const RAN_ID: i64 = 3;

pub struct InterceptLine<'a> {
    pub argv: &'a [String],
    pub env: &'a [(String, String)],
    pub cwd: &'a str,
    pub ppid: u32,
}

/// Key for key what `encodeInterceptLine` writes, because the golden fixture holds both to it.
pub fn intercept_line(line: &InterceptLine) -> String {
    let mut out = String::with_capacity(4096);
    out.push_str(&format!(
        "{{\"id\":{PLAN_ID},\"method\":\"intercept\",\"fast\":{VERSION},\"argv\":["
    ));
    for (index, arg) in line.argv.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        json::quote(arg, &mut out);
    }
    out.push_str("],\"cwd\":");
    json::quote(line.cwd, &mut out);
    out.push_str(&format!(",\"ppid\":{},\"env\":{{", line.ppid));
    for (index, (name, value)) in line.env.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        json::quote(name, &mut out);
        out.push(':');
        json::quote(value, &mut out);
    }
    out.push_str("}}\n");
    out
}

/// Written once the plan is acted on; the daemon answers it with no line.
pub fn acted_line() -> &'static str {
    "{\"id\":2,\"method\":\"intercept-acted\"}\n"
}

pub fn ran_line(exit_code: i32) -> String {
    format!("{{\"id\":{RAN_ID},\"method\":\"intercept-ran\",\"exitCode\":{exit_code}}}\n")
}

#[derive(Debug, PartialEq)]
pub enum Plan {
    Node,
    Pass { real: String, path: String },
    Run { real: String, path: String, notes: Vec<String> },
    Refuse { notes: Vec<String>, exit_code: i32 },
}

/// Anything not exactly this version's answer to this request is `Node`, never a guess.
pub fn plan_of(line: &str) -> Plan {
    let Some(value) = json::parse(line) else { return Plan::Node };
    if value.field("id").and_then(Value::integer) != Some(PLAN_ID)
        || value.field("ok") != Some(&Value::Bool(true))
        || value.field("fast").and_then(Value::integer) != Some(VERSION)
    {
        return Plan::Node;
    }
    let notes = notes_of(&value);
    let text = |name: &str| value.field(name).and_then(Value::text).map(str::to_owned);
    match (value.field("plan").and_then(Value::text), notes) {
        (Some("pass"), _) => match (text("real"), text("path")) {
            (Some(real), Some(path)) => Plan::Pass { real, path },
            _ => Plan::Node,
        },
        (Some("run"), Some(notes)) => match (text("real"), text("path")) {
            (Some(real), Some(path)) => Plan::Run { real, path, notes },
            _ => Plan::Node,
        },
        (Some("refuse"), Some(notes)) => match value.field("exitCode").and_then(Value::integer) {
            Some(code) if (1..=255).contains(&code) => Plan::Refuse { notes, exit_code: code as i32 },
            _ => Plan::Node,
        },
        _ => Plan::Node,
    }
}

/// The lines to print, or None when the field is there and is not a list of strings.
pub fn notes_of(value: &Value) -> Option<Vec<String>> {
    match value.field("notes") {
        None => Some(Vec::new()),
        Some(Value::List(items)) => items.iter().map(|each| each.text().map(str::to_owned)).collect(),
        Some(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixture(name: &str) -> String {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures").join(name);
        fs::read_to_string(path).expect("fixture")
    }

    #[test]
    fn writes_the_golden_request() {
        let input = json::parse(&fixture("intercept-request.input.json")).expect("input");
        let strings = |value: &Value| -> Vec<String> {
            match value {
                Value::List(items) => items.iter().map(|each| each.text().expect("text").to_owned()).collect(),
                _ => panic!("not a list"),
            }
        };
        let argv = strings(input.field("argv").expect("argv"));
        let env: Vec<(String, String)> = match input.field("env").expect("env") {
            Value::List(pairs) => pairs
                .iter()
                .map(|pair| {
                    let both = strings(pair);
                    (both[0].clone(), both[1].clone())
                })
                .collect(),
            _ => panic!("env is pairs"),
        };
        let cwd = input.field("cwd").and_then(Value::text).expect("cwd");
        let ppid = input.field("ppid").and_then(Value::integer).expect("ppid") as u32;
        let line = intercept_line(&InterceptLine { argv: &argv, env: &env, cwd, ppid });
        assert_eq!(line, fixture("intercept-request.golden"));
    }

    #[test]
    fn reads_each_plan() {
        assert_eq!(
            plan_of(r#"{"id":1,"ok":true,"fast":1,"plan":"run","real":"/usr/bin/git","path":"/usr/bin","notes":["w"]}"#),
            Plan::Run { real: "/usr/bin/git".into(), path: "/usr/bin".into(), notes: vec!["w".into()] }
        );
        assert_eq!(
            plan_of(r#"{"id":1,"ok":true,"fast":1,"plan":"refuse","notes":["no"],"exitCode":1}"#),
            Plan::Refuse { notes: vec!["no".into()], exit_code: 1 }
        );
        assert_eq!(
            plan_of(r#"{"id":1,"ok":true,"fast":1,"plan":"pass","real":"/bin/ls","path":"/bin"}"#),
            Plan::Pass { real: "/bin/ls".into(), path: "/bin".into() }
        );
    }

    #[test]
    fn doubts_go_to_node() {
        for line in [
            r#"{"id":1,"ok":false,"error":"no method intercept"}"#,
            r#"{"id":1,"ok":true,"fast":2,"plan":"run","real":"/x","path":"/"}"#,
            r#"{"id":2,"ok":true,"fast":1,"plan":"run","real":"/x","path":"/"}"#,
            r#"{"id":1,"ok":true,"fast":1,"plan":"ask"}"#,
            r#"{"id":1,"ok":true,"fast":1,"plan":"run","path":"/"}"#,
            r#"{"id":1,"ok":true,"fast":1,"plan":"run","real":"/x","path":"/","notes":[1]}"#,
            r#"{"id":1,"ok":true,"fast":1,"plan":"refuse","notes":[],"exitCode":0}"#,
            "not json",
        ] {
            assert_eq!(plan_of(line), Plan::Node, "{line}");
        }
    }
}
