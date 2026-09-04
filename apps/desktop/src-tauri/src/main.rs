// Prevents an extra console window from appearing alongside the app on Windows
// release builds. Debug builds keep it so `println!` is visible.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    redbeam_lib::run()
}
