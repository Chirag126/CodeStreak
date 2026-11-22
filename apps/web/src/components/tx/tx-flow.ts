// State machine for one on-chain action: build → sign → confirm. Pure reducer (tested) + hook.
import type { FriendlyError } from '@codestreak/shared/errors';
import { friendlyTxError } from '@codestreak/shared/errors';
import { useCallback, useReducer } from 'react';

export const TX_STEPS = [
  { id: 'build', label: 'Prepare', hint: 'Checking and building the transaction' },
  { id: 'sign', label: 'Approve', hint: 'Approve it in your wallet' },
  { id: 'confirm', label: 'Confirm', hint: 'Waiting for Solana devnet to confirm' },
] as const;
export type TxStepId = (typeof TX_STEPS)[number]['id'];
export type TxStepStatus = 'pending' | 'active' | 'done' | 'error';

export interface TxFlowState {
  status: 'idle' | 'running' | 'success' | 'error';
  steps: Record<TxStepId, TxStepStatus>;
  signature?: string;
  error?: FriendlyError;
}

export type TxFlowAction =
  | { type: 'start' }
  | { type: 'step'; step: TxStepId }
  | { type: 'succeed'; signature: string }
  | { type: 'fail'; error: FriendlyError };

const allPending = (): Record<TxStepId, TxStepStatus> => ({ build: 'pending', sign: 'pending', confirm: 'pending' });

export const initialTxFlow: TxFlowState = { status: 'idle', steps: allPending() };

export function txFlowReducer(state: TxFlowState, action: TxFlowAction): TxFlowState {
  switch (action.type) {
    case 'start':
      return { status: 'running', steps: { ...allPending(), build: 'active' } };
    case 'step': {
      if (state.status !== 'running') return state;
      const order = TX_STEPS.map((s) => s.id);
      const target = order.indexOf(action.step);
      const steps = { ...state.steps };
      order.forEach((id, i) => {
        steps[id] = i < target ? 'done' : i === target ? 'active' : 'pending';
      });
      return { ...state, steps };
    }
    case 'succeed':
      return { status: 'success', steps: { build: 'done', sign: 'done', confirm: 'done' }, signature: action.signature };
    case 'fail': {
      const steps = { ...state.steps };
      const active = (Object.keys(steps) as TxStepId[]).find((id) => steps[id] === 'active') ?? 'build';
      steps[active] = 'error';
      return { ...state, status: 'error', steps, error: action.error };
    }
  }
}

export interface TxFlowControl {
  step: (step: TxStepId) => void;
}

/**
 * Runs an action through the stepper. The callback reports progress with `step()`, returns the
 * signature on success, and may throw anything: errors become plain messages.
 */
export function useTxFlow() {
  const [state, dispatch] = useReducer(txFlowReducer, initialTxFlow);
  const run = useCallback(async (action: (ctl: TxFlowControl) => Promise<string>): Promise<{ ok: true; signature: string } | { ok: false; error: FriendlyError }> => {
    dispatch({ type: 'start' });
    try {
      const signature = await action({ step: (step) => dispatch({ type: 'step', step }) });
      dispatch({ type: 'succeed', signature });
      return { ok: true, signature };
    } catch (e) {
      const error = isFriendly(e) ? e : friendlyTxError(e);
      dispatch({ type: 'fail', error });
      return { ok: false, error };
    }
  }, []);
  return { state, run };
}

/** Throw one of these from a flow when the server already produced a friendly error. */
export class TxFlowError extends Error implements FriendlyError {
  readonly code: string;
  readonly title: string;
  constructor(error: FriendlyError) {
    super(error.message);
    this.code = error.code;
    this.title = error.title;
  }
}

function isFriendly(e: unknown): e is FriendlyError {
  return e instanceof TxFlowError;
}
