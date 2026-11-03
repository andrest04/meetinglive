/** Show the floating call popup only when the setting is on, nothing is recording, and the call was not prompted yet. */
export function shouldShowPopup(
  enabled: boolean,
  captureActive: boolean,
  alreadyPrompted: boolean,
): boolean {
  return enabled && !captureActive && !alreadyPrompted;
}
