import { Module } from '@nestjs/common';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';
import { CostsController } from './costs.controller';
import { CostsService } from './costs.service';
import { WarehousesController } from './warehouses.controller';
import { WarehousesService } from './warehouses.service';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { FuelStockController } from './fuel-stock.controller';

@Module({
  controllers: [
    PartnersController,
    CostsController,
    WarehousesController,
    StockController,
    FuelStockController,
  ],
  providers: [PartnersService, CostsService, WarehousesService, StockService],
})
export class ErpModule {}
