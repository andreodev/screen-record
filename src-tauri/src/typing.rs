/// Records only typing activity. Key identities and typed text never leave this sampler.
pub(crate) struct TypingActivity {
    down: [bool; 256],
    last_pulse: Option<f64>,
    shortcut: bool,
}

impl Default for TypingActivity {
    fn default() -> Self {
        Self { down: [false; 256], last_pulse: None, shortcut: false }
    }
}

impl TypingActivity {
    pub(crate) fn sample(&mut self, time: f64, pressed: impl Fn(u16) -> bool) -> bool {
        // Ctrl, Alt and Windows shortcuts are not typing sections.
        let shortcut = [0x11, 0x12, 0x5b, 0x5c].into_iter().any(&pressed);
        let mut held = false;
        let mut started = false;
        for key in 0u16..256 {
            let text_key = matches!(key, 0x08 | 0x0d | 0x20 | 0x2e | 0xe2 | 0xe7)
                || (0x30..=0x5a).contains(&key)
                || (0x60..=0x6f).contains(&key)
                || (0xba..=0xc0).contains(&key)
                || (0xdb..=0xdf).contains(&key);
            if !text_key { continue; }
            let down = pressed(key);
            started |= down && !self.down[key as usize];
            held |= down;
            self.down[key as usize] = down;
        }
        self.shortcut |= shortcut;
        if !held {
            self.shortcut = false;
            self.last_pulse = None;
            return false;
        }
        if self.shortcut { return false; }
        let pulse = started || self.last_pulse.is_none_or(|last| time - last >= 0.12);
        if pulse { self.last_pulse = Some(time); }
        pulse
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typing_activity_tracks_bursts_repeats_and_stops_without_text() {
        let mut activity = TypingActivity::default();
        assert!(!activity.sample(0., |_| false));
        assert!(activity.sample(0.1, |key| key == 0x41));
        assert!(!activity.sample(0.11, |key| key == 0x41));
        assert!(activity.sample(0.23, |key| key == 0x41));
        assert!(activity.sample(0.24, |key| key == 0x42));
        assert!(!activity.sample(0.3, |_| false));
        assert!(!activity.sample(1., |key| key == 0x25)); // Navigation is not typing.
        assert!(activity.sample(1.1, |key| key == 0x08)); // Editing text is activity.
        assert!(!activity.sample(1.2, |_| false));
    }

    #[test]
    fn shortcuts_and_lingering_keys_do_not_generate_typing() {
        for modifier in [0x11, 0x12, 0x5b, 0x5c] {
            let mut activity = TypingActivity::default();
            assert!(!activity.sample(0., |key| key == modifier || key == 0x43));
            assert!(!activity.sample(0.1, |key| key == 0x43));
            assert!(!activity.sample(0.2, |_| false));
            assert!(activity.sample(0.3, |key| key == 0x43));
        }
    }
}
