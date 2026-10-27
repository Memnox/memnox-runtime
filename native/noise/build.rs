fn main() {
    // Only the Node addon needs napi's link flags; the iOS static library must not carry them.
    if std::env::var_os("CARGO_FEATURE_NODE").is_some() {
        napi_build::setup();
    }
}
