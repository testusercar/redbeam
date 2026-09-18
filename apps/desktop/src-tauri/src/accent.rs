//! The Windows accent colour, read from the user's own theme.
//!
//! REDBEAM had one accent of its own — a red, reserved for brand, active
//! navigation and focus. On a window that is otherwise the system's material,
//! an accent the system did not choose is the one thing that still says "not a
//! Windows app": it fights the user's chosen colour everywhere the two appear
//! together, in the title bar of the window next to this one most of all.
//!
//! ## Why the palette and not `AccentColor`
//!
//! `DWM\AccentColor` is the base tone, chosen to sit under white text on a
//! LIGHT ground. On a dark ground WinUI does not use it — it uses
//! `SystemAccentColorLight2`, two steps up, for exactly the contrast reason.
//! Windows publishes the whole ramp in `Explorer\Accent\AccentPalette`: eight
//! 4-byte RGBA entries, lightest first, so index 1 is Light2 and index 2 is
//! Light1. Reading the ramp is what makes the accent legible rather than
//! merely correct.

use serde::Serialize;

/// The three steps the UI actually paints with, as `#rrggbb`.
#[derive(Debug, Clone, Serialize)]
pub struct Accent {
    /// `SystemAccentColorLight2` — the accent on a dark ground.
    pub light2: String,
    /// `SystemAccentColorLight1` — hover and pressed.
    pub light1: String,
    /// The base tone, for a light ground.
    pub base: String,
    /// False when Windows published no palette and the default below is in use.
    pub from_system: bool,
    /// Where it came from: `palette` (the Explorer accent ramp), `dwm` (the
    /// single DWM accent, lightened here), or `default`. Settings › About
    /// says which, so "the accent is wrong" can be diagnosed from a
    /// screenshot rather than a registry export.
    pub source: &'static str,
}

/*
 * Windows' own default blue, used only when the palette cannot be read.
 *
 * Not a REDBEAM colour and not a derivation: these are the values Windows
 * ships for its default accent, so an install that has never had one chosen
 * still looks like the system rather than like us.
 */
const DEFAULT_LIGHT2: &str = "#4CC2FF";
const DEFAULT_LIGHT1: &str = "#0091F8";
const DEFAULT_BASE: &str = "#0078D4";

impl Default for Accent {
    fn default() -> Self {
        Self {
            light2: DEFAULT_LIGHT2.to_string(),
            light1: DEFAULT_LIGHT1.to_string(),
            base: DEFAULT_BASE.to_string(),
            from_system: false,
            source: "default",
        }
    }
}

/// One channel, moved a fraction of the way towards white.
fn lighten(c: u8, by: f32) -> u8 {
    (f32::from(c) + (255.0 - f32::from(c)) * by).round().clamp(0.0, 255.0) as u8
}

/// The accent from `DWM\AccentColor`, a DWORD laid out `0xAABBGGRR`.
///
/// Windows publishes only the base tone there, so the two lighter steps the
/// dark theme paints with are made here: 20% and 40% towards white, which
/// is close to the ramp Windows itself generates.
fn from_dwm(value: u32) -> Accent {
    let r = (value & 0xff) as u8;
    let g = ((value >> 8) & 0xff) as u8;
    let b = ((value >> 16) & 0xff) as u8;
    let step = |by: f32| [lighten(r, by), lighten(g, by), lighten(b, by), 0];
    Accent {
        light2: hex(&step(0.4)).unwrap_or_else(|| DEFAULT_LIGHT2.to_string()),
        light1: hex(&step(0.2)).unwrap_or_else(|| DEFAULT_LIGHT1.to_string()),
        base: hex(&[r, g, b, 0]).unwrap_or_else(|| DEFAULT_BASE.to_string()),
        from_system: true,
        source: "dwm",
    }
}

/// `#rrggbb` from one 4-byte RGBA palette entry.
fn hex(entry: &[u8]) -> Option<String> {
    let (r, g, b) = (*entry.first()?, *entry.get(1)?, *entry.get(2)?);
    Some(format!("#{r:02X}{g:02X}{b:02X}"))
}

#[cfg(windows)]
fn read() -> Option<Accent> {
    // The ramp first; failing that, the one DWM colour. A machine that has
    // an accent but no published palette (some managed images, some early
    // sessions) was falling all the way to the default.
    read_palette().or_else(read_dwm)
}

#[cfg(windows)]
fn read_palette() -> Option<Accent> {
    let key = windows_registry::CURRENT_USER
        .open(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Accent")
        .ok()?;
    let value = key.get_value("AccentPalette").ok()?;
    let bytes: &[u8] = value.as_ref();
    // Eight entries. Anything shorter is not the palette this reads.
    if bytes.len() < 32 {
        return None;
    }
    Some(Accent {
        light2: hex(&bytes[4..8])?,
        light1: hex(&bytes[8..12])?,
        base: hex(&bytes[12..16])?,
        from_system: true,
        source: "palette",
    })
}

#[cfg(windows)]
fn read_dwm() -> Option<Accent> {
    let key = windows_registry::CURRENT_USER
        .open(r"Software\Microsoft\Windows\DWM")
        .ok()?;
    let value = key.get_u32("AccentColor").ok()?;
    Some(from_dwm(value))
}

#[cfg(not(windows))]
fn read() -> Option<Accent> {
    None
}

/// The accent to paint with. Never fails — a missing palette is Windows'
/// default blue, which is a correct answer rather than an error to handle.
#[tauri::command]
pub fn system_accent() -> Accent {
    read().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_palette_entry_as_rgba_not_bgra() {
        // Aaron's own palette, 2026-09-03: the Light2 entry is D6 B7 9F.
        // Read as BGRA this would be #9FB7D6 — a blue, and the exact mistake
        // that would make every accent in the app the wrong hue.
        assert_eq!(hex(&[0xD6, 0xB7, 0x9F, 0x00]).unwrap(), "#D6B79F");
    }

    #[test]
    fn falls_back_to_windows_own_default_rather_than_a_redbeam_colour() {
        let a = Accent::default();
        assert_eq!(a.light2, "#4CC2FF");
        assert!(!a.from_system, "the default must not claim to be the user's");
    }

    #[test]
    fn refuses_a_truncated_palette() {
        assert!(hex(&[0x11, 0x22]).is_none());
    }

    #[test]
    fn reads_the_dwm_dword_as_abgr_and_makes_the_lighter_steps() {
        // The same D6 B7 9F, as DWM stores it: alpha, blue, green, red.
        let a = from_dwm(0xFF9F_B7D6);
        assert_eq!(a.base, "#D6B79F");
        assert_eq!(a.source, "dwm");
        assert!(a.from_system);
        // Each step is lighter than the last, and none overshoots white.
        assert_eq!(a.light1, "#DEC5B2");
        assert_eq!(a.light2, "#E6D4C5");
    }
}

#[cfg(all(test, windows))]
mod on_this_machine {
    /// Not an assertion about a colour — a check that the key path and the byte
    /// layout still hold against a real registry. A machine that has never had
    /// an accent chosen reports the default, which is also a pass.
    #[test]
    fn reads_the_registry_without_panicking() {
        let a = super::system_accent();
        println!("accent: light2={} light1={} base={} from_system={}",
                 a.light2, a.light1, a.base, a.from_system);
        for c in [&a.light2, &a.light1, &a.base] {
            assert_eq!(c.len(), 7, "not #rrggbb: {c}");
            assert!(c.starts_with('#'));
            assert!(u32::from_str_radix(&c[1..], 16).is_ok(), "not hex: {c}");
        }
    }
}
