import { MAX_TOASTS, pushToast, runUndo, toastLift } from '../src/ui/toastStack';

describe('toast stack', () => {
  it('keeps up to three, newest last, dropping the oldest', () => {
    let list: number[] = [];
    for (let i = 1; i <= 5; i++) list = pushToast(list, i);
    expect(list).toEqual([3, 4, 5]);
    expect(list).toHaveLength(MAX_TOASTS);
  });

  it('reports a failed undo instead of throwing', async () => {
    await expect(runUndo(() => Promise.reject(new Error('gone')))).resolves.toBe(false);
    await expect(
      runUndo(() => {
        throw new Error('sync');
      }),
    ).resolves.toBe(false);
    await expect(runUndo(async () => 1)).resolves.toBe(true);
  });

  it('clears the measured tab bar only on tab screens', () => {
    expect(toastLift('/', 96, 34)).toBe(108);
    expect(toastLift('/desk', 0, 34)).toBe(46);
    expect(toastLift('/item/abc', 96, 34)).toBe(50);
  });
});
