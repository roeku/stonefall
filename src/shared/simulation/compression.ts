import { deflate, inflate } from 'fflate';
import { DropInput } from './types';

// Compression utilities for replay data
export interface CompressedReplay {
  seed: number;
  mode: string;
  inputs: string; // Base64 encoded compressed data
  metadata: {
    tickRate: number;
    totalTicks: number;
    inputCount: number;
  };
}

export class ReplayCompression {
  // Compress array of drop inputs to base64 string
  static compressInputs(inputs: ReadonlyArray<DropInput>): Promise<string> {
    return new Promise((resolve, reject) => {
      // Delta encode the tick values for better compression
      const deltaEncoded = ReplayCompression.deltaEncode(inputs.map((input) => input.tick));

      // Convert to Uint8Array
      const inputBuffer = new Uint8Array(deltaEncoded.length * 4);
      const view = new DataView(inputBuffer.buffer);

      for (let i = 0; i < deltaEncoded.length; i++) {
        const value = deltaEncoded[i];
        if (value !== undefined) {
          view.setUint32(i * 4, value, true); // Little endian
        }
      }

      // Compress using deflate
      deflate(inputBuffer, { level: 9 }, (err, compressed) => {
        if (err) {
          reject(err);
          return;
        }

        // Convert to base64
        const base64 = btoa(String.fromCharCode(...compressed));
        resolve(base64);
      });
    });
  }

  // Decompress base64 string back to drop inputs
  static decompressInputs(compressed: string): Promise<DropInput[]> {
    return new Promise((resolve, reject) => {
      try {
        // Decode from base64
        const binaryString = atob(compressed);
        const compressedData = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          compressedData[i] = binaryString.charCodeAt(i);
        }

        // Decompress
        inflate(compressedData, (err, decompressed) => {
          if (err) {
            reject(err);
            return;
          }

          // Convert back to tick array
          const view = new DataView(decompressed.buffer);
          const deltaEncoded: number[] = [];

          for (let i = 0; i < decompressed.length; i += 4) {
            deltaEncoded.push(view.getUint32(i, true)); // Little endian
          }

          // Delta decode
          const ticks = ReplayCompression.deltaDecode(deltaEncoded);

          // Convert to DropInput array
          const inputs: DropInput[] = ticks.map((tick) => ({ tick }));
          resolve(inputs);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  // Delta encode array of numbers (store differences)
  private static deltaEncode(values: number[]): number[] {
    if (values.length === 0) return [];

    const encoded = [values[0] ?? 0];
    for (let i = 1; i < values.length; i++) {
      const current = values[i] ?? 0;
      const previous = values[i - 1] ?? 0;
      encoded.push(current - previous);
    }
    return encoded;
  }

  // Delta decode array of differences back to original values
  private static deltaDecode(encoded: number[]): number[] {
    if (encoded.length === 0) return [];

    const decoded = [encoded[0] ?? 0];
    for (let i = 1; i < encoded.length; i++) {
      const current = encoded[i] ?? 0;
      const previous = decoded[i - 1] ?? 0;
      decoded.push(previous + current);
    }
    return decoded;
  }

  // Create compressed replay object
  static async createCompressedReplay(
    seed: number,
    mode: string,
    inputs: ReadonlyArray<DropInput>,
    tickRate: number = 60
  ): Promise<CompressedReplay> {
    const compressedInputs = await ReplayCompression.compressInputs(inputs);
    const totalTicks = inputs.length > 0 ? Math.max(...inputs.map((i) => i.tick)) : 0;

    return {
      seed,
      mode,
      inputs: compressedInputs,
      metadata: {
        tickRate,
        totalTicks,
        inputCount: inputs.length,
      },
    };
  }

  // Extract inputs from compressed replay
  static async extractInputsFromReplay(replay: CompressedReplay): Promise<DropInput[]> {
    return ReplayCompression.decompressInputs(replay.inputs);
  }
}
