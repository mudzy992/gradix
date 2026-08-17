ALTER TABLE `DiaryEntry` ADD COLUMN `deviceId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `DiaryEntry_companyId_deviceId_localId_key` ON `DiaryEntry`(`companyId`, `deviceId`, `localId`);
