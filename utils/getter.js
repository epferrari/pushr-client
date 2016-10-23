"use strict";

export default function getter(obj, propName, fn){
  Object.defineProperty(obj, propName, {
    get: () => fn(),
    enumerable: false,
    configurable: false,
    writable: false
  });
};
