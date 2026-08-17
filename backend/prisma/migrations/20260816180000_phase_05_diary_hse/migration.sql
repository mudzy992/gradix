-- CreateTable
CREATE TABLE `DiaryEntry` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `weather` VARCHAR(191) NULL,
    `tempMin` DECIMAL(4, 1) NULL,
    `tempMax` DECIMAL(4, 1) NULL,
    `workDescription` TEXT NULL,
    `problemsNoted` TEXT NULL,
    `workersCount` INTEGER NULL,
    `pdfUrl` VARCHAR(191) NULL,
    `isVoiceInput` BOOLEAN NOT NULL DEFAULT false,
    `isSynced` BOOLEAN NOT NULL DEFAULT true,
    `localId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DiaryEntry_projectId_idx`(`projectId`),
    UNIQUE INDEX `DiaryEntry_companyId_projectId_date_key`(`companyId`, `projectId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DiaryPhoto` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `diaryEntryId` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `caption` VARCHAR(191) NULL,
    `lat` DECIMAL(10, 7) NULL,
    `lng` DECIMAL(10, 7) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DiaryPhoto_diaryEntryId_idx`(`diaryEntryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Incident` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `taskId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NOT NULL,
    `severity` ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL,
    `description` TEXT NOT NULL,
    `lat` DECIMAL(10, 7) NULL,
    `lng` DECIMAL(10, 7) NULL,
    `status` ENUM('OPEN', 'ACK', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Incident_companyId_status_idx`(`companyId`, `status`),
    INDEX `Incident_projectId_idx`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `IncidentPhoto` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `incidentId` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IncidentPhoto_incidentId_idx`(`incidentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DiaryEntry` ADD CONSTRAINT `DiaryEntry_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `DiaryEntry` ADD CONSTRAINT `DiaryEntry_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DiaryPhoto` ADD CONSTRAINT `DiaryPhoto_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `DiaryPhoto` ADD CONSTRAINT `DiaryPhoto_diaryEntryId_fkey` FOREIGN KEY (`diaryEntryId`) REFERENCES `DiaryEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Incident` ADD CONSTRAINT `Incident_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Incident` ADD CONSTRAINT `Incident_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Incident` ADD CONSTRAINT `Incident_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Incident` ADD CONSTRAINT `Incident_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `IncidentPhoto` ADD CONSTRAINT `IncidentPhoto_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `IncidentPhoto` ADD CONSTRAINT `IncidentPhoto_incidentId_fkey` FOREIGN KEY (`incidentId`) REFERENCES `Incident`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
