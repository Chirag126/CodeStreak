'use client';

import { useState } from 'react';
import { SignInForm } from './sign-in-form';
import { WalletSignIn } from './wallet-sign-in';

/** Email and wallet sign-in together: starting a wallet sign-in clears the email form's old error. */
export function SignInMethods({ next, linkError }: { next: string; linkError?: boolean }) {
  const [usingWallet, setUsingWallet] = useState(false);
  return (
    <>
      <SignInForm next={next} linkError={linkError} hideError={usingWallet} onEmailStart={() => setUsingWallet(false)} />
      <WalletSignIn next={next} onStart={() => setUsingWallet(true)} />
    </>
  );
}
