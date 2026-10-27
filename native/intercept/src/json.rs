//! Strings written byte for byte as `JSON.stringify` writes them, and a parser for the daemon's one line.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Text(String),
    List(Vec<Value>),
    Object(BTreeMap<String, Value>),
}

impl Value {
    pub fn field(&self, name: &str) -> Option<&Value> {
        match self {
            Value::Object(fields) => fields.get(name),
            _ => None,
        }
    }

    pub fn text(&self) -> Option<&str> {
        match self {
            Value::Text(text) => Some(text),
            _ => None,
        }
    }

    /// Only a whole number in range, since an exit code or an id is never a fraction.
    pub fn integer(&self) -> Option<i64> {
        match self {
            Value::Number(n) if n.fract() == 0.0 && n.abs() < 9.0e15 => Some(*n as i64),
            _ => None,
        }
    }
}

/// A JSON string literal exactly as `JSON.stringify` writes it, which the golden fixture holds.
pub fn quote(text: &str, out: &mut String) {
    out.push('"');
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// None for anything that is not exactly one JSON value, which the caller treats as a doubt.
pub fn parse(text: &str) -> Option<Value> {
    let mut parser = Parser { bytes: text.as_bytes(), at: 0, depth: 0 };
    let value = parser.value()?;
    parser.space();
    if parser.at == parser.bytes.len() {
        Some(value)
    } else {
        None
    }
}

/// Deep enough for any answer this protocol has; a deeper one is not the daemon.
const MOST_DEPTH: usize = 16;

struct Parser<'a> {
    bytes: &'a [u8],
    at: usize,
    depth: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.at).copied()
    }

    fn space(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.at += 1;
        }
    }

    fn literal(&mut self, word: &str, value: Value) -> Option<Value> {
        if self.bytes[self.at..].starts_with(word.as_bytes()) {
            self.at += word.len();
            Some(value)
        } else {
            None
        }
    }

    fn value(&mut self) -> Option<Value> {
        self.space();
        match self.peek()? {
            b'n' => self.literal("null", Value::Null),
            b't' => self.literal("true", Value::Bool(true)),
            b'f' => self.literal("false", Value::Bool(false)),
            b'"' => self.string().map(Value::Text),
            b'[' => self.nested(|p| p.list()),
            b'{' => self.nested(|p| p.object()),
            _ => self.number(),
        }
    }

    fn nested(&mut self, read: impl FnOnce(&mut Self) -> Option<Value>) -> Option<Value> {
        self.depth += 1;
        if self.depth > MOST_DEPTH {
            return None;
        }
        let value = read(self);
        self.depth -= 1;
        value
    }

    fn list(&mut self) -> Option<Value> {
        self.at += 1;
        let mut items = Vec::new();
        self.space();
        if self.peek()? == b']' {
            self.at += 1;
            return Some(Value::List(items));
        }
        loop {
            items.push(self.value()?);
            self.space();
            match self.peek()? {
                b',' => self.at += 1,
                b']' => {
                    self.at += 1;
                    return Some(Value::List(items));
                }
                _ => return None,
            }
        }
    }

    fn object(&mut self) -> Option<Value> {
        self.at += 1;
        let mut fields = BTreeMap::new();
        self.space();
        if self.peek()? == b'}' {
            self.at += 1;
            return Some(Value::Object(fields));
        }
        loop {
            self.space();
            if self.peek()? != b'"' {
                return None;
            }
            let name = self.string()?;
            self.space();
            if self.peek()? != b':' {
                return None;
            }
            self.at += 1;
            let value = self.value()?;
            fields.insert(name, value);
            self.space();
            match self.peek()? {
                b',' => self.at += 1,
                b'}' => {
                    self.at += 1;
                    return Some(Value::Object(fields));
                }
                _ => return None,
            }
        }
    }

    fn number(&mut self) -> Option<Value> {
        let start = self.at;
        while matches!(self.peek(), Some(b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9')) {
            self.at += 1;
        }
        let text = std::str::from_utf8(&self.bytes[start..self.at]).ok()?;
        if text.is_empty() {
            return None;
        }
        text.parse::<f64>().ok().filter(|n| n.is_finite()).map(Value::Number)
    }

    fn string(&mut self) -> Option<String> {
        self.at += 1;
        let mut out = String::new();
        loop {
            let start = self.at;
            while !matches!(self.peek()?, b'"' | b'\\') {
                if self.peek()? < 0x20 {
                    return None;
                }
                self.at += 1;
            }
            out.push_str(std::str::from_utf8(&self.bytes[start..self.at]).ok()?);
            if self.peek()? == b'"' {
                self.at += 1;
                return Some(out);
            }
            self.at += 1;
            let escape = self.peek()?;
            self.at += 1;
            match escape {
                b'"' => out.push('"'),
                b'\\' => out.push('\\'),
                b'/' => out.push('/'),
                b'b' => out.push('\u{08}'),
                b'f' => out.push('\u{0c}'),
                b'n' => out.push('\n'),
                b'r' => out.push('\r'),
                b't' => out.push('\t'),
                b'u' => out.push(self.unicode()?),
                _ => return None,
            }
        }
    }

    fn hex4(&mut self) -> Option<u32> {
        let digits = self.bytes.get(self.at..self.at + 4)?;
        let value = u32::from_str_radix(std::str::from_utf8(digits).ok()?, 16).ok()?;
        self.at += 4;
        Some(value)
    }

    /// A surrogate pair is joined; a lone half is a doubt, never a replacement character.
    fn unicode(&mut self) -> Option<char> {
        let first = self.hex4()?;
        if (0xd800..0xdc00).contains(&first) {
            if self.bytes.get(self.at..self.at + 2)? != b"\\u" {
                return None;
            }
            self.at += 2;
            let second = self.hex4()?;
            if !(0xdc00..0xe000).contains(&second) {
                return None;
            }
            return char::from_u32(0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00));
        }
        char::from_u32(first)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_as_json_stringify_does() {
        let mut out = String::new();
        quote("a\"b\\c\nd\u{1}é/😀\u{7f}", &mut out);
        assert_eq!(out, "\"a\\\"b\\\\c\\nd\\u0001é/😀\u{7f}\"");
    }

    #[test]
    fn parses_an_answer() {
        let value = parse(r#"{"id":1,"ok":true,"notes":["a\u00e9","\ud83d\ude00"],"n":-2.5e1}"#)
            .expect("parses");
        assert_eq!(value.field("id").and_then(Value::integer), Some(1));
        assert_eq!(value.field("ok"), Some(&Value::Bool(true)));
        assert_eq!(
            value.field("notes"),
            Some(&Value::List(vec![Value::Text("aé".into()), Value::Text("😀".into())]))
        );
        assert_eq!(value.field("n"), Some(&Value::Number(-25.0)));
    }

    #[test]
    fn refuses_what_is_not_one_value() {
        assert_eq!(parse("{\"id\":1} x"), None);
        assert_eq!(parse("{\"id\":\"\\ud800\"}"), None);
        assert_eq!(parse("[[[[[[[[[[[[[[[[[[1]]]]]]]]]]]]]]]]]"), None);
        assert_eq!(parse(""), None);
    }
}
