/** Something about settings the user should hear, shown once on the Settings page until dismissed. */
export interface SettingsNotice {
  readonly kind: 'settings-recovered';
  /** Where the damaged `settings.json` was kept. */
  readonly keptAs: string;
}

export interface PendingNotice extends SettingsNotice {
  readonly id: SettingsNotice['kind'];
}

/** One notice per kind: a newer report replaces an older one. */
export class SettingsNotices {
  private readonly byKind = new Map<SettingsNotice['kind'], SettingsNotice>();

  add(notice: SettingsNotice): void {
    this.byKind.set(notice.kind, notice);
  }

  dismiss(id: string): void {
    for (const kind of this.byKind.keys()) if (kind === id) this.byKind.delete(kind);
  }

  pending(): PendingNotice[] {
    return [...this.byKind.values()].map((notice) => ({ id: notice.kind, ...notice }));
  }
}
