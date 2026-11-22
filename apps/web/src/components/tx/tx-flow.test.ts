import { describe, expect, it } from 'vitest';
import { initialTxFlow, txFlowReducer, type TxFlowAction, type TxFlowState } from './tx-flow';

const play = (...actions: TxFlowAction[]) => actions.reduce<TxFlowState>(txFlowReducer, initialTxFlow);

describe('transaction flow', () => {
  it('walks build → sign → confirm and ends with the signature', () => {
    expect(play({ type: 'start' }).steps).toEqual({ build: 'active', sign: 'pending', confirm: 'pending' });
    expect(play({ type: 'start' }, { type: 'step', step: 'sign' }).steps).toEqual({ build: 'done', sign: 'active', confirm: 'pending' });
    expect(play({ type: 'start' }, { type: 'step', step: 'confirm' }).steps).toEqual({ build: 'done', sign: 'done', confirm: 'active' });
    expect(play({ type: 'start' }, { type: 'step', step: 'confirm' }, { type: 'succeed', signature: 'sig' })).toEqual({
      status: 'success',
      steps: { build: 'done', sign: 'done', confirm: 'done' },
      signature: 'sig',
    });
  });

  it('marks the step that failed and keeps the friendly error', () => {
    const error = { code: 'wallet.rejected', title: 'Cancelled in your wallet', message: 'You declined.' };
    const s = play({ type: 'start' }, { type: 'step', step: 'sign' }, { type: 'fail', error });
    expect(s.status).toBe('error');
    expect(s.steps).toEqual({ build: 'done', sign: 'error', confirm: 'pending' });
    expect(s.error).toBe(error);
  });

  it('a failed simulation fails the first step; a new attempt starts clean', () => {
    const error = { code: 'program.JoinClosed', title: 't', message: 'm' };
    const failed = play({ type: 'start' }, { type: 'fail', error });
    expect(failed.steps.build).toBe('error');
    expect(txFlowReducer(failed, { type: 'start' })).toEqual({ status: 'running', steps: { build: 'active', sign: 'pending', confirm: 'pending' } });
  });

  it('ignores progress after the flow ended', () => {
    const done = play({ type: 'start' }, { type: 'succeed', signature: 's' });
    expect(txFlowReducer(done, { type: 'step', step: 'sign' })).toBe(done);
  });

  it('resets to idle after a result, but never mid-flight', () => {
    const done = play({ type: 'start' }, { type: 'succeed', signature: 's' });
    expect(txFlowReducer(done, { type: 'reset' })).toEqual(initialTxFlow);
    const running = play({ type: 'start' }, { type: 'step', step: 'sign' });
    expect(txFlowReducer(running, { type: 'reset' })).toBe(running);
  });
});
