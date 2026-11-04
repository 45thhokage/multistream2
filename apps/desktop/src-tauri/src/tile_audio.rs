use tauri::Webview;

pub fn page_volume(volume: f64) -> Result<Option<f64>, String> {
    if !volume.is_finite() || !(0.0..=1.0).contains(&volume) {
        return Err("volume must be between 0 and 1".to_string());
    }
    // Zero is output mute. Do not expose a zero volume to the player page.
    Ok((volume > 0.0).then_some(volume))
}

#[cfg(windows)]
pub async fn set_output_muted(webview: &Webview, muted: bool) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
    use windows_core::Interface;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    webview
        .with_webview(move |platform| {
            // All COM access stays on the WebView's UI thread.
            let result = unsafe {
                platform
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.cast::<ICoreWebView2_8>())
                    .and_then(|core| core.SetIsMuted(muted))
            }
            .map_err(|error| format!("failed to mute tile output: {error}"));
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
    receiver
        .await
        .map_err(|_| "tile output operation cancelled".to_string())?
}

#[cfg(not(windows))]
pub async fn set_output_muted(_webview: &Webview, _muted: bool) -> Result<(), String> {
    Err("native tile output mute is currently supported on Windows only".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_mutes_output_without_writing_page_volume() {
        // Arrange
        let volume = 0.0;
        // Act
        let result = page_volume(volume);
        // Assert
        assert_eq!(result, Ok(None));
    }

    #[test]
    fn rejects_invalid_volume() {
        // Arrange
        let inputs = [-0.1, 1.1, f64::NAN, f64::INFINITY];
        // Act
        let results = inputs.map(page_volume);
        // Assert
        assert!(results.iter().all(Result::is_err));
    }

    #[test]
    fn preserves_nonzero_volume() {
        // Arrange
        let volume = 0.5;
        // Act
        let result = page_volume(volume);
        // Assert
        assert_eq!(result, Ok(Some(0.5)));
    }
}
