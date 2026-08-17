-- CreateTable
CREATE TABLE `Tender` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `client` VARCHAR(191) NOT NULL,
    `submittedValue` DECIMAL(12, 2) NULL,
    `submittedAt` DATETIME(3) NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'WON', 'LOST', 'WITHDRAWN') NOT NULL DEFAULT 'DRAFT',
    `notes` TEXT NULL,
    `convertedProjectId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Tender_convertedProjectId_key`(`convertedProjectId`),
    INDEX `Tender_companyId_status_idx`(`companyId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TenderAttachment` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `tenderId` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TenderAttachment_tenderId_idx`(`tenderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ServiceTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `machineType` ENUM('TRUCK', 'EXCAVATOR', 'LOADER', 'GRADER', 'ROLLER', 'PAVER', 'DUMPER', 'COMPRESSOR', 'OTHER') NOT NULL,
    `intervalHours` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ServiceTemplate_companyId_machineType_idx`(`companyId`, `machineType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ServiceRecord` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `machineId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `templateId` VARCHAR(191) NULL,
    `status` ENUM('PLANNED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PLANNED',
    `scheduledAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `totalCost` DECIMAL(12, 2) NULL,
    `note` TEXT NULL,
    `previousMachineStatus` ENUM('IDLE', 'ACTIVE', 'IN_SERVICE', 'DECOMMISSIONED') NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ServiceRecord_companyId_status_idx`(`companyId`, `status`),
    INDEX `ServiceRecord_machineId_idx`(`machineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CompanyDocument` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(80) NOT NULL,
    `filePath` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CompanyDocument_companyId_expiresAt_idx`(`companyId`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WorkerDocument` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(80) NOT NULL,
    `filePath` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WorkerDocument_companyId_expiresAt_idx`(`companyId`, `expiresAt`),
    INDEX `WorkerDocument_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MachineDocument` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `machineId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(80) NOT NULL,
    `filePath` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MachineDocument_companyId_expiresAt_idx`(`companyId`, `expiresAt`),
    INDEX `MachineDocument_machineId_idx`(`machineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Tender` ADD CONSTRAINT `Tender_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Tender` ADD CONSTRAINT `Tender_convertedProjectId_fkey` FOREIGN KEY (`convertedProjectId`) REFERENCES `Project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `TenderAttachment` ADD CONSTRAINT `TenderAttachment_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `TenderAttachment` ADD CONSTRAINT `TenderAttachment_tenderId_fkey` FOREIGN KEY (`tenderId`) REFERENCES `Tender`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ServiceTemplate` ADD CONSTRAINT `ServiceTemplate_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ServiceRecord` ADD CONSTRAINT `ServiceRecord_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ServiceRecord` ADD CONSTRAINT `ServiceRecord_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ServiceRecord` ADD CONSTRAINT `ServiceRecord_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ServiceRecord` ADD CONSTRAINT `ServiceRecord_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `ServiceTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CompanyDocument` ADD CONSTRAINT `CompanyDocument_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `WorkerDocument` ADD CONSTRAINT `WorkerDocument_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `WorkerDocument` ADD CONSTRAINT `WorkerDocument_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MachineDocument` ADD CONSTRAINT `MachineDocument_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MachineDocument` ADD CONSTRAINT `MachineDocument_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
