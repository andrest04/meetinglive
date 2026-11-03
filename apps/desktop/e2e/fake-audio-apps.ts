// Apps that "play" audio in the fake native build, for the audio-capture e2e and screenshots.
export const FAKE_APPS = JSON.stringify([
  { processId: 4100, exePath: 'C:\\Fake\\Zoom.exe', name: 'Zoom Workplace', peak: 0.2 },
  { processId: 4200, exePath: 'C:\\Fake\\chrome.exe', name: 'Google Chrome', peak: 0.05 },
  { processId: 4300, exePath: 'C:\\Fake\\player.exe', name: 'Music player', peak: 0.1 },
]);
