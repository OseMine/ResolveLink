/** @type {import('../../package.json')} */
import pkg from '../../package.json';

/** @type {string} */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION
  ? `v${import.meta.env.VITE_APP_VERSION}`
  : `v${pkg.version}`;