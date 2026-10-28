import type { MdStudioApi } from '../shared/api';

declare global {
  interface Window {
    mdstudio: MdStudioApi;
  }
}

export {};
