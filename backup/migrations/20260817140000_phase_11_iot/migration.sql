ALTER TABLE `Machine` ADD COLUMN `lastGpsSource` ENUM('PHONE', 'IOT') NULL;

CREATE TABLE `GpsDevice` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `machineId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `apiKeyHash` VARCHAR(255) NOT NULL,
    `keyLookup` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastSeenAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `GpsDevice_machineId_key`(`machineId`),
    UNIQUE INDEX `GpsDevice_keyLookup_key`(`keyLookup`),
    INDEX `GpsDevice_companyId_idx`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `GpsDevice` ADD CONSTRAINT `GpsDevice_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `GpsDevice` ADD CONSTRAINT `GpsDevice_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
