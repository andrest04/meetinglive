import { applyHighlights } from '../transcription/highlights';

/**
 * The canvas text of a take: the live transcript with the highlight stars (spec 3.11). The star
 * pass reads the whole text, so it runs only when the text or the marks changed (B-22): a status
 * change, a level tick or a repeated update with the same text reuses the last result.
 */
export class HighlightedLiveText {
  private text: string | null = null;
  private marksKey = '';
  private result = '';
  private computations = 0;

  render(text: string, marks: readonly number[]): string {
    if (marks.length === 0) return text;
    const key = marks.join(',');
    if (this.text === text && this.marksKey === key) return this.result;
    this.text = text;
    this.marksKey = key;
    this.result = applyHighlights(text, marks);
    this.computations += 1;
    return this.result;
  }

  /** How many times the star pass ran. For tests. */
  get passes(): number {
    return this.computations;
  }
}
