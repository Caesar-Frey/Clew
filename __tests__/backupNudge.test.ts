import { BACKUP_STALE_MS, backupDue, showFirstBackupCard } from '../src/lib/backupNudge';

describe('backup nudges', () => {
  const now = 1_000 * BACKUP_STALE_MS;
  it('dots the Desk tab with no backup only from 10 things', () => {
    expect(backupDue({ things: 9, lastChangeAt: now, lastBackupAt: null, now })).toBe(false);
    expect(backupDue({ things: 10, lastChangeAt: now, lastBackupAt: null, now })).toBe(true);
  });

  it('dots it when the last backup is over 30 days old and things changed since', () => {
    const old = now - BACKUP_STALE_MS - 1;
    expect(backupDue({ things: 3, lastChangeAt: now - 5, lastBackupAt: old, now })).toBe(true);
    expect(backupDue({ things: 3, lastChangeAt: old - 5, lastBackupAt: old, now })).toBe(false);
    expect(backupDue({ things: 3, lastChangeAt: now, lastBackupAt: now - 1000, now })).toBe(false);
  });

  it('shows the first-backup card after the first save until a backup or dismissal', () => {
    expect(showFirstBackupCard({ things: 0, lastBackupAt: null, dismissed: false })).toBe(false);
    expect(showFirstBackupCard({ things: 1, lastBackupAt: null, dismissed: false })).toBe(true);
    expect(showFirstBackupCard({ things: 1, lastBackupAt: null, dismissed: true })).toBe(false);
    expect(showFirstBackupCard({ things: 1, lastBackupAt: 5, dismissed: false })).toBe(false);
  });
});
