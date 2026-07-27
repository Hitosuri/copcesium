import type { Viewer } from 'cesium';
import type { CopcDataSourceOptions } from './types';

export type { CopcDataSourceOptions };

export class CopcDataSource {
  static async load(
    _url: string,
    _viewer: Viewer,
    _options?: CopcDataSourceOptions,
  ): Promise<CopcDataSource> {
    throw new Error('Not implemented yet');
  }

  destroy(): void {
    throw new Error('Not implemented yet');
  }
}
