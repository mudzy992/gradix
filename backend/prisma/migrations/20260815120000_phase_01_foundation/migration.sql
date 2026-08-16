-- CreateTable
CREATE TABLE `Company` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `legalName` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `country` VARCHAR(191) NOT NULL DEFAULT 'BA',
    `taxId` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `logoPath` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Company_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `employeeCode` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NULL,
    `hourlyRate` DECIMAL(12, 2) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT true,
    `locale` ENUM('bs', 'en') NOT NULL DEFAULT 'bs',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    UNIQUE INDEX `User_phone_key`(`phone`),
    INDEX `User_companyId_idx`(`companyId`),
    UNIQUE INDEX `User_companyId_employeeCode_key`(`companyId`, `employeeCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserRoleAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` ENUM('PLATFORM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER', 'SITE_SUPERVISOR', 'MACHINE_OPERATOR', 'DRIVER', 'WORKER', 'MECHANIC', 'ACCOUNTANT') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `UserRoleAssignment_userId_idx`(`userId`),
    UNIQUE INDEX `UserRoleAssignment_userId_role_key`(`userId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RefreshToken` (
    `id` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RefreshToken_tokenHash_key`(`tokenHash`),
    INDEX `RefreshToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Device` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `fcmToken` VARCHAR(191) NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Device_userId_idx`(`userId`),
    UNIQUE INDEX `Device_userId_deviceId_key`(`userId`, `deviceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Setting` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `scope` ENUM('PUBLIC', 'PRIVATE', 'SECRET') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Setting_companyId_idx`(`companyId`),
    UNIQUE INDEX `Setting_companyId_key_key`(`companyId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('TASK_DISPATCHED', 'TASK_COMPLETED', 'TIMER_FORCE_CLOSED', 'TIMER_AUTO_CLOSED', 'GEOFENCE_ENTER', 'GEOFENCE_EXIT', 'DOCUMENT_EXPIRING', 'SERVICE_DUE', 'FUEL_ANOMALY', 'HSE_CREATED', 'AMENDMENT_CREATED', 'DIARY_CONFLICT', 'PAYROLL_REJECTED') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `data` JSON NOT NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Notification_companyId_idx`(`companyId`),
    INDEX `Notification_userId_isRead_idx`(`userId`, `isRead`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditEvent` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` ENUM('USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'USER_ROLES_CHANGED', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'SETTINGS_UPDATED', 'COMPANY_CREATED', 'COMPANY_UPDATED', 'COMPANY_DEACTIVATED', 'PROJECT_CREATED', 'PROJECT_STATUS', 'TASK_COMPLETED', 'TASK_CANCELLED', 'TIMER_AUTO_CLOSED', 'TIMER_FORCE_CLOSED', 'TIMER_AMENDED', 'TRIP_AMENDED', 'FUEL_AMENDED', 'MACHINE_HOURS_CORRECTED', 'PAYROLL_APPROVED', 'PAYROLL_REJECTED', 'COST_ENTRY_CREATED', 'STOCK_MOVEMENT') NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AuditEvent_companyId_idx`(`companyId`),
    INDEX `AuditEvent_actorId_idx`(`actorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserRoleAssignment` ADD CONSTRAINT `UserRoleAssignment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RefreshToken` ADD CONSTRAINT `RefreshToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Device` ADD CONSTRAINT `Device_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Setting` ADD CONSTRAINT `Setting_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditEvent` ADD CONSTRAINT `AuditEvent_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditEvent` ADD CONSTRAINT `AuditEvent_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

