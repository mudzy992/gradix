-- CreateTable
CREATE TABLE `PublicAsset` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `mime` VARCHAR(191) NOT NULL,
    `kind` ENUM('LOGO', 'COVER') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PublicAsset_companyId_kind_idx`(`companyId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PublicAsset` ADD CONSTRAINT `PublicAsset_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Company` ADD COLUMN `logoAssetId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `Company_logoAssetId_key` ON `Company`(`logoAssetId`);

ALTER TABLE `Company` ADD CONSTRAINT `Company_logoAssetId_fkey` FOREIGN KEY (`logoAssetId`) REFERENCES `PublicAsset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Project` ADD COLUMN `coverAssetId` VARCHAR(191) NULL;

ALTER TABLE `Project` ADD CONSTRAINT `Project_coverAssetId_fkey` FOREIGN KEY (`coverAssetId`) REFERENCES `PublicAsset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
