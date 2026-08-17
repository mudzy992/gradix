import { Readable } from 'node:stream';

type Stored = { buffer: Buffer; size: number };

export class MemoryMinioClient {
  private readonly objects = new Map<string, Stored>();

  async bucketExists(): Promise<boolean> {
    return true;
  }

  async makeBucket(): Promise<void> {
    return;
  }

  async putObject(
    _bucket: string,
    objectPath: string,
    buffer: Buffer,
    size: number,
  ): Promise<void> {
    this.objects.set(objectPath, { buffer, size });
  }

  async getObject(_bucket: string, objectPath: string): Promise<Readable> {
    const stored = this.objects.get(objectPath);
    if (!stored) {
      throw new Error('not found');
    }
    return Readable.from(stored.buffer);
  }
}

export class MemoryMinioService {
  readonly client = new MemoryMinioClient();
  readonly bucket = 'gradix';

  async onModuleInit(): Promise<void> {
    return;
  }
}
