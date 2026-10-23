use serde::{Deserialize, Serialize};

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct RecordingOptions {
    pub output_device: Option<String>,
    pub microphone_device: Option<String>,
    pub camera_device: Option<String>,
    pub microphone_processing: MicrophoneProcessing,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct MicrophoneProcessing {
    pub noise_suppression: bool,
    pub noise_reduction: f64,
    pub high_pass: bool,
    pub compressor: bool,
    pub threshold_db: f64,
    pub ratio: f64,
    pub makeup_db: f64,
}
impl Default for MicrophoneProcessing {
    fn default() -> Self {
        Self {
            noise_suppression: true,
            noise_reduction: 12.,
            high_pass: true,
            compressor: true,
            threshold_db: -18.,
            ratio: 3.,
            makeup_db: 3.,
        }
    }
}
impl RecordingOptions {
    pub fn validate(&self) -> Result<(), String> {
        if [
            &self.output_device,
            &self.microphone_device,
            &self.camera_device,
        ]
        .into_iter()
        .flatten()
        .any(|id| id.len() > 4096 || id.contains('\0'))
        {
            return Err("Identificador de dispositivo inválido.".into());
        }
        self.microphone_processing.validate()
    }
}
impl MicrophoneProcessing {
    fn validate(&self) -> Result<(), String> {
        for (value, low, high) in [
            (self.noise_reduction, 6., 30.),
            (self.threshold_db, -36., -6.),
            (self.ratio, 1., 8.),
            (self.makeup_db, 0., 12.),
        ] {
            if !value.is_finite() || value < low || value > high {
                return Err("Configuração de tratamento do microfone inválida.".into());
            }
        }
        Ok(())
    }
    #[cfg(windows)]
    pub fn filter(&self) -> String {
        let mut filters = Vec::new();
        if self.high_pass {
            filters.push("highpass=f=80".to_string());
        }
        if self.noise_suppression {
            filters.push(format!(
                "afftdn=nr={}:nf=-35:tn=0:gs=8",
                self.noise_reduction
            ));
        }
        if self.compressor {
            filters.push(format!(
                "acompressor=threshold={}dB:ratio={}:attack=10:release=180:makeup={}dB:knee=2.828",
                self.threshold_db, self.ratio, self.makeup_db
            ));
        }
        if !filters.is_empty() {
            filters.push("alimiter=limit=0.891:level=0:latency=1".to_string());
        }
        if filters.is_empty() {
            "anull".into()
        } else {
            filters.join(",")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_clean_microphone_and_reject_invalid_settings() {
        let options = RecordingOptions::default();
        assert!(options.microphone_processing.noise_suppression);
        assert!(options.microphone_processing.compressor);
        assert!(options.validate().is_ok());
        let mut invalid = options.clone();
        invalid.microphone_processing.ratio = f64::NAN;
        assert!(invalid.validate().is_err());
        invalid = options;
        invalid.output_device = Some("invalid\0device".into());
        assert!(invalid.validate().is_err());
    }
}
