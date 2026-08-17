import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { PublicController } from './public.controller';
import { PublicWriteController } from './public-write.controller';
import { PublicService } from './public.service';

@Module({
  imports: [FilesModule],
  controllers: [PublicController, PublicWriteController],
  providers: [PublicService],
})
export class PublicModule {}
