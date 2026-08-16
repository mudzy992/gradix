import request from 'supertest';
import { INestApplication } from '@nestjs/common';

const password = process.env.SEED_PASSWORD ?? 'GradixSeed1';

export async function login(
  app: INestApplication,
  email: string,
  pwd = password,
) {
  const response = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: pwd });
  return response;
}

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
    string,
    unknown
  >;
}
