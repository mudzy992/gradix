-- CreateTable
CREATE TABLE `Machine` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NULL,
    `type` ENUM('TRUCK', 'EXCAVATOR', 'LOADER', 'GRADER', 'ROLLER', 'PAVER', 'DUMPER', 'COMPRESSOR', 'OTHER') NOT NULL,
    `status` ENUM('IDLE', 'ACTIVE', 'IN_SERVICE', 'DECOMMISSIONED') NOT NULL DEFAULT 'IDLE',
    `currentWorkingHours` DECIMAL(12, 3) NOT NULL DEFAULT 0,
    `lastLat` DECIMAL(10, 7) NULL,
    `lastLng` DECIMAL(10, 7) NULL,
    `lastGpsAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Machine_companyId_status_idx`(`companyId`, `status`),
    UNIQUE INDEX `Machine_companyId_code_key`(`companyId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MachineAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `machineId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MachineAssignment_machineId_idx`(`machineId`),
    INDEX `MachineAssignment_projectId_idx`(`projectId`),
    INDEX `MachineAssignment_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Material` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `unit` ENUM('M3', 'T', 'M', 'M2', 'PCS', 'H', 'L') NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Material_companyId_isActive_idx`(`companyId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Depot` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `qrToken` VARCHAR(191) NOT NULL,
    `lat` DECIMAL(10, 7) NULL,
    `lng` DECIMAL(10, 7) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Depot_qrToken_key`(`qrToken`),
    INDEX `Depot_companyId_isActive_idx`(`companyId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Trip` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `driverId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `machineId` VARCHAR(191) NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(12, 3) NOT NULL,
    `originText` VARCHAR(191) NOT NULL,
    `originLat` DECIMAL(10, 7) NULL,
    `originLng` DECIMAL(10, 7) NULL,
    `destDepotId` VARCHAR(191) NULL,
    `destLat` DECIMAL(10, 7) NULL,
    `destLng` DECIMAL(10, 7) NULL,
    `weighTicketPath` VARCHAR(191) NULL,
    `weighQty` DECIMAL(12, 3) NULL,
    `notes` TEXT NULL,
    `loadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `unloadedAt` DATETIME(3) NULL,
    `isSynced` BOOLEAN NOT NULL DEFAULT true,
    `localId` VARCHAR(191) NULL,
    `deviceId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Trip_companyId_projectId_idx`(`companyId`, `projectId`),
    INDEX `Trip_driverId_idx`(`driverId`),
    INDEX `Trip_machineId_idx`(`machineId`),
    UNIQUE INDEX `Trip_companyId_driverId_deviceId_localId_key`(`companyId`, `driverId`, `deviceId`, `localId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FuelEntry` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `machineId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `liters` DECIMAL(12, 3) NOT NULL,
    `unitPrice` DECIMAL(12, 2) NOT NULL,
    `totalCost` DECIMAL(12, 2) NOT NULL,
    `notes` TEXT NULL,
    `receiptPath` VARCHAR(191) NULL,
    `isSynced` BOOLEAN NOT NULL DEFAULT true,
    `localId` VARCHAR(191) NULL,
    `deviceId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FuelEntry_companyId_projectId_idx`(`companyId`, `projectId`),
    INDEX `FuelEntry_machineId_idx`(`machineId`),
    UNIQUE INDEX `FuelEntry_companyId_userId_deviceId_localId_key`(`companyId`, `userId`, `deviceId`, `localId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `UserLocation` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `lat` DECIMAL(10, 7) NOT NULL,
    `lng` DECIMAL(10, 7) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `accuracyM` DECIMAL(8, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `UserLocation_companyId_userId_recordedAt_idx`(`companyId`, `userId`, `recordedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `GpsRecord` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `machineId` VARCHAR(191) NOT NULL,
    `lat` DECIMAL(10, 7) NOT NULL,
    `lng` DECIMAL(10, 7) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `source` ENUM('PHONE', 'IOT') NOT NULL DEFAULT 'PHONE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `GpsRecord_machineId_recordedAt_idx`(`machineId`, `recordedAt`),
    INDEX `GpsRecord_companyId_idx`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `TimerSession_machineId_idx` ON `TimerSession`(`machineId`);

CREATE UNIQUE INDEX `MachineAssignment_one_active` ON `MachineAssignment` (`machineId`, (IF(`endedAt` IS NULL, 1, NULL)));
CREATE UNIQUE INDEX `TimerSession_open_machine_mutex` ON `TimerSession` (`companyId`, (IF(`closedAt` IS NULL AND `machineId` IS NOT NULL, `machineId`, NULL)));

ALTER TABLE `Machine` ADD CONSTRAINT `Machine_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MachineAssignment` ADD CONSTRAINT `MachineAssignment_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MachineAssignment` ADD CONSTRAINT `MachineAssignment_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MachineAssignment` ADD CONSTRAINT `MachineAssignment_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MachineAssignment` ADD CONSTRAINT `MachineAssignment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Material` ADD CONSTRAINT `Material_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Depot` ADD CONSTRAINT `Depot_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Trip` ADD CONSTRAINT `Trip_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Trip` ADD CONSTRAINT `Trip_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Trip` ADD CONSTRAINT `Trip_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Trip` ADD CONSTRAINT `Trip_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Trip` ADD CONSTRAINT `Trip_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `Material`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Trip` ADD CONSTRAINT `Trip_destDepotId_fkey` FOREIGN KEY (`destDepotId`) REFERENCES `Depot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `FuelEntry` ADD CONSTRAINT `FuelEntry_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `FuelEntry` ADD CONSTRAINT `FuelEntry_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `FuelEntry` ADD CONSTRAINT `FuelEntry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `FuelEntry` ADD CONSTRAINT `FuelEntry_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `UserLocation` ADD CONSTRAINT `UserLocation_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `UserLocation` ADD CONSTRAINT `UserLocation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `GpsRecord` ADD CONSTRAINT `GpsRecord_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `GpsRecord` ADD CONSTRAINT `GpsRecord_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `TimerSession` ADD CONSTRAINT `TimerSession_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
