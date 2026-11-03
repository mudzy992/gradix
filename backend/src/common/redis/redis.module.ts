import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/** INF-07: globalno, jer throttle storage i readiness provjera trebaju isti klijent. */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
