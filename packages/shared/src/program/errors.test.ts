import { describe, expect, it } from 'vitest';
import { errorFromCode, errorFromLogs, friendlyTxError } from './errors.js';

describe('friendly transaction errors', () => {
  it('maps a rejected signature in any wallet wording', () => {
    for (const err of [{ code: 4001, message: 'User rejected the request.' }, new Error('Transaction cancelled by user'), 'User declined']) {
      expect(friendlyTxError(err)).toMatchObject({ code: 'wallet.rejected', title: 'Cancelled in your wallet' });
    }
  });

  it('maps a failed simulation from Anchor logs to the rule that refused it', () => {
    const logs = [
      'Program A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J invoke [1]',
      'Program log: AnchorError thrown in programs/codestreak/src/instructions/join_pool.rs:57. Error Code: JoinClosed. Error Number: 6014. Error Message: Joining is closed for this challenge.',
    ];
    expect(errorFromLogs(logs)).toEqual({ code: 'program.JoinClosed', title: 'The challenge rules refused this', message: 'Joining has closed for this challenge.' });
    expect(friendlyTxError(new Error('Simulation failed'), logs).code).toBe('program.JoinClosed');
  });

  it('maps numeric custom errors (hex and JSON forms) through the IDL', () => {
    expect(errorFromCode(6000)?.code).toBe('program.Unauthorized');
    expect(friendlyTxError(new Error('custom program error: 0x177e')).code).toBe(errorFromCode(0x177e)!.code);
    expect(friendlyTxError({ InstructionError: [2, { Custom: 6015 }] }).code).toBe(errorFromCode(6015)!.code);
    expect(errorFromCode(99999)).toBeNull();
  });

  it('explains missing tokens, missing SOL and Anchor constraint failures', () => {
    expect(errorFromLogs(['Program log: Error: insufficient funds'])?.code).toBe('token.insufficient_funds');
    expect(errorFromLogs(['Transfer: insufficient lamports 10, need 5000'])?.code).toBe('sol.insufficient');
    expect(errorFromLogs(['Program log: AnchorError caused by account: user_token. Error Code: ConstraintTokenOwner.'])?.message).toMatch(
      /does not belong to your wallet/,
    );
  });

  it('handles expiry, network trouble and the unknown', () => {
    expect(friendlyTxError(new Error('Blockhash not found')).code).toBe('tx.expired');
    expect(friendlyTxError(new Error('TypeError: Failed to fetch')).code).toBe('network');
    expect(friendlyTxError(new Error('weird')).code).toBe('unknown');
  });

  it('every program error has readable text', () => {
    for (let code = 6000; code < 6047; code++) {
      const e = errorFromCode(code);
      if (e) expect(e.message.length).toBeGreaterThan(5);
    }
  });
});
