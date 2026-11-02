// pdf.js calls Promise.withResolvers with no fallback, and unlike its other new features its legacy build
// does not polyfill it. Browsers before Chrome 119, Safari 17.4 (iOS 17.4) and Firefox 121 lack it, so every
// PDF failed there. Imported first on the page and first in the PDF worker.
type WithResolvers = <T>() => { promise: Promise<T>; resolve: (v: T | PromiseLike<T>) => void; reject: (e?: unknown) => void };
const P = Promise as PromiseConstructor & { withResolvers?: WithResolvers };

if (typeof P.withResolvers !== 'function') {
  Object.defineProperty(P, 'withResolvers', {
    configurable: true,
    writable: true,
    value: function withResolvers<T>(this: PromiseConstructor) {
      let resolve!: (v: T | PromiseLike<T>) => void;
      let reject!: (e?: unknown) => void;
      const promise = new this<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    },
  });
}

export {};
