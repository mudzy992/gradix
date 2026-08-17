import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { IotService } from './iot.service';
import { IotGpsDto } from './iot.dto';

@Public()
@Controller('iot')
export class IotController {
  constructor(private readonly iot: IotService) {}

  @Post('gps')
  ingest(@Headers('x-device-key') key: string | undefined, @Body() dto: IotGpsDto) {
    return this.iot.ingest(key, dto);
  }
}
