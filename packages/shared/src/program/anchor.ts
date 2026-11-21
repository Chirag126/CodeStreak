// @anchor-lang/core ships CommonJS for Node and ESM for browsers. Under Node's ESM loader its
// classes are reliably reachable only through the CommonJS `default` export, while bundlers
// (Next.js) expose them as named exports. Resolve both once here; import Anchor runtime values
// from this module, and types directly from "@anchor-lang/core".
import * as anchorNamespace from '@anchor-lang/core';

type AnchorLib = typeof anchorNamespace;

function resolveAnchor(): AnchorLib {
  const ns = anchorNamespace as unknown as AnchorLib & { default?: AnchorLib };
  if (typeof ns.Program === 'function') return ns;
  if (ns.default && typeof ns.default.Program === 'function') return ns.default;
  throw new Error('@anchor-lang/core could not be loaded');
}

export const anchor: AnchorLib = resolveAnchor();
