-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MANAGER', 'SUPERVISOR', 'OPERATOR');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'LEFT');

-- CreateEnum
CREATE TYPE "AreaType" AS ENUM ('WASH', 'MEDIA', 'INOCULATION', 'INCUBATION', 'QC', 'HARDENING', 'STORE');

-- CreateEnum
CREATE TYPE "Phase" AS ENUM ('INITIATION', 'MULTIPLICATION', 'ROOTING', 'HARDENING');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('RUNNING', 'CLOSED');

-- CreateEnum
CREATE TYPE "TrayStatus" AS ENUM ('ACTIVE', 'MOVED', 'LOST', 'SENT');

-- CreateEnum
CREATE TYPE "LossCause" AS ENUM ('LAB', 'OPERATOR', 'SEASON', 'MEDIA');

-- CreateEnum
CREATE TYPE "LossType" AS ENUM ('FUNGAL', 'BACTERIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "AttStatus" AS ENUM ('P', 'HD', 'A');

-- CreateEnum
CREATE TYPE "WorkKind" AS ENUM ('SUBCULTURE', 'WASH', 'MEDIA', 'QC_MEDIA', 'QC_CULTURE');

-- CreateEnum
CREATE TYPE "EntrySource" AS ENUM ('QR', 'MANUAL');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ItemCategory" AS ENUM ('CHEMICAL', 'CONSUMABLE', 'HARDENING', 'OTHER');

-- CreateEnum
CREATE TYPE "TxnType" AS ENUM ('IN', 'OUT', 'ADJ');

-- CreateEnum
CREATE TYPE "CostHeading" AS ENUM ('LABOUR', 'CHEMICALS', 'CONSUMABLES', 'POWER', 'HARDENING', 'OTHER');

-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('YES', 'PARTLY', 'NO');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('OPEN', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('ABOVE', 'BELOW');

-- CreateTable
CREATE TABLE "lab" (
    "labId" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,

    CONSTRAINT "lab_pkey" PRIMARY KEY ("labId")
);

-- CreateTable
CREATE TABLE "area" (
    "areaId" SERIAL NOT NULL,
    "labId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "areaType" "AreaType" NOT NULL,
    "roomNo" TEXT NOT NULL,

    CONSTRAINT "area_pkey" PRIMARY KEY ("areaId")
);

-- CreateTable
CREATE TABLE "bench" (
    "benchId" SERIAL NOT NULL,
    "areaId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "capacityTrays" INTEGER NOT NULL,

    CONSTRAINT "bench_pkey" PRIMARY KEY ("benchId")
);

-- CreateTable
CREATE TABLE "app_user" (
    "userId" SERIAL NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "homeAreaId" INTEGER,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "user_zone" (
    "userId" INTEGER NOT NULL,
    "areaId" INTEGER NOT NULL,

    CONSTRAINT "user_zone_pkey" PRIMARY KEY ("userId","areaId")
);

-- CreateTable
CREATE TABLE "auth_session" (
    "sessionId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE "password_reset" (
    "resetId" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_pkey" PRIMARY KEY ("resetId")
);

-- CreateTable
CREATE TABLE "crop" (
    "cropId" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "variety" TEXT NOT NULL,
    "defaultGrowth" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "crop_pkey" PRIMARY KEY ("cropId")
);

-- CreateTable
CREATE TABLE "stage" (
    "stageId" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "phase" "Phase" NOT NULL,
    "seqNo" INTEGER NOT NULL,
    "minDays" INTEGER NOT NULL,
    "maxDays" INTEGER NOT NULL,

    CONSTRAINT "stage_pkey" PRIMARY KEY ("stageId")
);

-- CreateTable
CREATE TABLE "media_recipe" (
    "recipeId" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "phase" "Phase" NOT NULL,
    "shelfLifeDays" INTEGER NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "media_recipe_pkey" PRIMARY KEY ("recipeId")
);

-- CreateTable
CREATE TABLE "alert_rule" (
    "ruleId" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "warnValue" DOUBLE PRECISION NOT NULL,
    "criticalValue" DOUBLE PRECISION,
    "notifyRole" "Role" NOT NULL,

    CONSTRAINT "alert_rule_pkey" PRIMARY KEY ("ruleId")
);

-- CreateTable
CREATE TABLE "settings" (
    "settingsId" INTEGER NOT NULL DEFAULT 1,
    "rootingSurvival" DOUBLE PRECISION NOT NULL,
    "hardeningSurvival" DOUBLE PRECISION NOT NULL,
    "lastMultiplicationStage" TEXT NOT NULL,
    "defaultRate" DOUBLE PRECISION,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("settingsId")
);

-- CreateTable
CREATE TABLE "batch" (
    "batchId" SERIAL NOT NULL,
    "batchCode" TEXT NOT NULL,
    "cropId" INTEGER NOT NULL,
    "parentBatchId" INTEGER,
    "startDate" DATE NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'RUNNING',

    CONSTRAINT "batch_pkey" PRIMARY KEY ("batchId")
);

-- CreateTable
CREATE TABLE "sample" (
    "sampleId" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "sampleType" TEXT NOT NULL,
    "noOfSamples" INTEGER NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "sourceFarm" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sample_pkey" PRIMARY KEY ("sampleId")
);

-- CreateTable
CREATE TABLE "tray" (
    "trayId" SERIAL NOT NULL,
    "qrCode" TEXT NOT NULL,
    "batchId" INTEGER NOT NULL,
    "stageId" INTEGER NOT NULL,
    "benchId" INTEGER NOT NULL,
    "mediaLotId" INTEGER,
    "bottleCount" INTEGER NOT NULL,
    "startBottles" INTEGER,
    "placedOn" DATE NOT NULL,
    "status" "TrayStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tray_pkey" PRIMARY KEY ("trayId")
);

-- CreateTable
CREATE TABLE "tray_movement" (
    "movementId" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "trayId" INTEGER,
    "newTrayIds" INTEGER[],
    "takenTrayIds" INTEGER[],
    "fromStageId" INTEGER NOT NULL,
    "toStageId" INTEGER NOT NULL,
    "fromBenchId" INTEGER,
    "toBenchId" INTEGER,
    "bottlesIn" INTEGER NOT NULL,
    "bottlesOut" INTEGER NOT NULL,
    "bottlesLost" INTEGER NOT NULL,
    "movedBy" INTEGER NOT NULL,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tray_movement_pkey" PRIMARY KEY ("movementId")
);

-- CreateTable
CREATE TABLE "contamination" (
    "contId" SERIAL NOT NULL,
    "trayId" INTEGER NOT NULL,
    "bottlesLost" INTEGER NOT NULL,
    "cause" "LossCause" NOT NULL,
    "contType" "LossType" NOT NULL,
    "foundOn" DATE NOT NULL,
    "reportedBy" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "contamination_pkey" PRIMARY KEY ("contId")
);

-- CreateTable
CREATE TABLE "attendance" (
    "attId" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "workDate" DATE NOT NULL,
    "status" "AttStatus" NOT NULL,
    "markedBy" INTEGER NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("attId")
);

-- CreateTable
CREATE TABLE "work_assignment" (
    "assignId" SERIAL NOT NULL,
    "workDate" DATE NOT NULL,
    "operatorId" INTEGER NOT NULL,
    "kind" "WorkKind" NOT NULL DEFAULT 'SUBCULTURE',
    "areaId" INTEGER,
    "batchId" INTEGER,
    "stageId" INTEGER,
    "benchId" INTEGER,
    "targetBottles" INTEGER NOT NULL,
    "targetContaminated" INTEGER NOT NULL DEFAULT 0,
    "recipeId" INTEGER,
    "mediaBatchCode" TEXT,
    "assignedBy" INTEGER NOT NULL,

    CONSTRAINT "work_assignment_pkey" PRIMARY KEY ("assignId")
);

-- CreateTable
CREATE TABLE "production_entry" (
    "entryId" SERIAL NOT NULL,
    "assignId" INTEGER,
    "operatorId" INTEGER NOT NULL,
    "kind" "WorkKind" NOT NULL DEFAULT 'SUBCULTURE',
    "source" "EntrySource" NOT NULL DEFAULT 'QR',
    "trayId" INTEGER,
    "batchId" INTEGER,
    "stageId" INTEGER,
    "areaId" INTEGER,
    "taken" JSONB,
    "contaminated" INTEGER NOT NULL DEFAULT 0,
    "mediaLotId" INTEGER,
    "enteredBy" INTEGER,
    "movementId" INTEGER,
    "contId" INTEGER,
    "workDate" DATE NOT NULL,
    "bottlesHandled" INTEGER NOT NULL,
    "bottlesProduced" INTEGER NOT NULL,
    "bottlesLost" INTEGER NOT NULL,
    "status" "EntryStatus" NOT NULL DEFAULT 'PENDING',
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedBy" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "production_entry_pkey" PRIMARY KEY ("entryId")
);

-- CreateTable
CREATE TABLE "item" (
    "itemId" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ItemCategory" NOT NULL,
    "unit" TEXT NOT NULL,
    "stockQty" DOUBLE PRECISION NOT NULL,
    "reorderLevel" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "item_pkey" PRIMARY KEY ("itemId")
);

-- CreateTable
CREATE TABLE "stock_txn" (
    "txnId" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "txnType" "TxnType" NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "mediaLotId" INTEGER,
    "txnDate" DATE NOT NULL,
    "doneBy" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "stock_txn_pkey" PRIMARY KEY ("txnId")
);

-- CreateTable
CREATE TABLE "media_lot" (
    "mediaLotId" SERIAL NOT NULL,
    "lotCode" TEXT NOT NULL,
    "recipeId" INTEGER NOT NULL,
    "preparedOn" DATE NOT NULL,
    "volumeLitre" DOUBLE PRECISION NOT NULL,
    "bottlesFilled" INTEGER NOT NULL,
    "expiresOn" DATE NOT NULL,
    "preparedBy" INTEGER NOT NULL,

    CONSTRAINT "media_lot_pkey" PRIMARY KEY ("mediaLotId")
);

-- CreateTable
CREATE TABLE "cost_entry" (
    "costId" SERIAL NOT NULL,
    "month" TEXT NOT NULL,
    "heading" "CostHeading" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "enteredBy" INTEGER NOT NULL,

    CONSTRAINT "cost_entry_pkey" PRIMARY KEY ("costId")
);

-- CreateTable
CREATE TABLE "sales_order" (
    "orderId" SERIAL NOT NULL,
    "orderCode" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "cropId" INTEGER NOT NULL,
    "plantsOrdered" INTEGER NOT NULL,
    "ratePerPlant" DECIMAL(10,2) NOT NULL,
    "requiredBy" DATE NOT NULL,
    "decision" "Decision" NOT NULL,
    "plantsPromised" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER NOT NULL,

    CONSTRAINT "sales_order_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "delivery" (
    "deliveryId" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "batchId" INTEGER NOT NULL,
    "plantsSent" INTEGER NOT NULL,
    "sentOn" DATE NOT NULL,
    "enteredBy" INTEGER NOT NULL,

    CONSTRAINT "delivery_pkey" PRIMARY KEY ("deliveryId")
);

-- CreateTable
CREATE TABLE "sensor_device" (
    "deviceId" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "areaId" INTEGER NOT NULL,
    "intervalMin" INTEGER NOT NULL,
    "apiKeyHash" TEXT,

    CONSTRAINT "sensor_device_pkey" PRIMARY KEY ("deviceId")
);

-- CreateTable
CREATE TABLE "sensor_reading" (
    "readingId" BIGSERIAL NOT NULL,
    "deviceId" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "tempC" DOUBLE PRECISION NOT NULL,
    "humidityPct" DOUBLE PRECISION NOT NULL,
    "lightLux" DOUBLE PRECISION,

    CONSTRAINT "sensor_reading_pkey" PRIMARY KEY ("readingId")
);

-- CreateTable
CREATE TABLE "alert" (
    "alertId" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "areaId" INTEGER,
    "severity" "Severity" NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackAt" TIMESTAMP(3),
    "ackBy" INTEGER,
    "key" TEXT,
    "userId" INTEGER,

    CONSTRAINT "alert_pkey" PRIMARY KEY ("alertId")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "auditId" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("auditId")
);

-- CreateIndex
CREATE UNIQUE INDEX "area_labId_name_key" ON "area"("labId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "bench_areaId_code_key" ON "bench"("areaId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_phone_key" ON "app_user"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_tokenHash_key" ON "auth_session"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_session_userId_idx" ON "auth_session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokenHash_key" ON "password_reset"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "crop_name_variety_key" ON "crop"("name", "variety");

-- CreateIndex
CREATE UNIQUE INDEX "stage_code_key" ON "stage"("code");

-- CreateIndex
CREATE UNIQUE INDEX "media_recipe_code_key" ON "media_recipe"("code");

-- CreateIndex
CREATE UNIQUE INDEX "alert_rule_code_key" ON "alert_rule"("code");

-- CreateIndex
CREATE UNIQUE INDEX "batch_batchCode_key" ON "batch"("batchCode");

-- CreateIndex
CREATE UNIQUE INDEX "tray_qrCode_key" ON "tray"("qrCode");

-- CreateIndex
CREATE INDEX "tray_batchId_stageId_status_idx" ON "tray"("batchId", "stageId", "status");

-- CreateIndex
CREATE INDEX "tray_benchId_status_idx" ON "tray"("benchId", "status");

-- CreateIndex
CREATE INDEX "tray_movement_batchId_movedAt_idx" ON "tray_movement"("batchId", "movedAt");

-- CreateIndex
CREATE INDEX "contamination_foundOn_idx" ON "contamination"("foundOn");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_userId_workDate_key" ON "attendance"("userId", "workDate");

-- CreateIndex
CREATE INDEX "work_assignment_workDate_operatorId_idx" ON "work_assignment"("workDate", "operatorId");

-- CreateIndex
CREATE INDEX "production_entry_workDate_idx" ON "production_entry"("workDate");

-- CreateIndex
CREATE INDEX "production_entry_operatorId_workDate_idx" ON "production_entry"("operatorId", "workDate");

-- CreateIndex
CREATE INDEX "production_entry_status_idx" ON "production_entry"("status");

-- CreateIndex
CREATE UNIQUE INDEX "item_name_key" ON "item"("name");

-- CreateIndex
CREATE INDEX "stock_txn_itemId_txnDate_idx" ON "stock_txn"("itemId", "txnDate");

-- CreateIndex
CREATE UNIQUE INDEX "media_lot_lotCode_key" ON "media_lot"("lotCode");

-- CreateIndex
CREATE UNIQUE INDEX "cost_entry_month_heading_key" ON "cost_entry"("month", "heading");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_orderCode_key" ON "sales_order"("orderCode");

-- CreateIndex
CREATE INDEX "sensor_reading_deviceId_recordedAt_idx" ON "sensor_reading"("deviceId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "alert_key_key" ON "alert"("key");

-- CreateIndex
CREATE INDEX "alert_createdAt_idx" ON "alert"("createdAt");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- AddForeignKey
ALTER TABLE "area" ADD CONSTRAINT "area_labId_fkey" FOREIGN KEY ("labId") REFERENCES "lab"("labId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bench" ADD CONSTRAINT "bench_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "area"("areaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_homeAreaId_fkey" FOREIGN KEY ("homeAreaId") REFERENCES "area"("areaId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_zone" ADD CONSTRAINT "user_zone_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_zone" ADD CONSTRAINT "user_zone_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "area"("areaId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset" ADD CONSTRAINT "password_reset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch" ADD CONSTRAINT "batch_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "crop"("cropId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch" ADD CONSTRAINT "batch_parentBatchId_fkey" FOREIGN KEY ("parentBatchId") REFERENCES "batch"("batchId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample" ADD CONSTRAINT "sample_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batch"("batchId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tray" ADD CONSTRAINT "tray_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batch"("batchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tray" ADD CONSTRAINT "tray_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "stage"("stageId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tray" ADD CONSTRAINT "tray_benchId_fkey" FOREIGN KEY ("benchId") REFERENCES "bench"("benchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tray" ADD CONSTRAINT "tray_mediaLotId_fkey" FOREIGN KEY ("mediaLotId") REFERENCES "media_lot"("mediaLotId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tray_movement" ADD CONSTRAINT "tray_movement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batch"("batchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tray_movement" ADD CONSTRAINT "tray_movement_trayId_fkey" FOREIGN KEY ("trayId") REFERENCES "tray"("trayId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tray_movement" ADD CONSTRAINT "tray_movement_fromStageId_fkey" FOREIGN KEY ("fromStageId") REFERENCES "stage"("stageId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tray_movement" ADD CONSTRAINT "tray_movement_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "stage"("stageId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tray_movement" ADD CONSTRAINT "tray_movement_movedBy_fkey" FOREIGN KEY ("movedBy") REFERENCES "app_user"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contamination" ADD CONSTRAINT "contamination_trayId_fkey" FOREIGN KEY ("trayId") REFERENCES "tray"("trayId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contamination" ADD CONSTRAINT "contamination_reportedBy_fkey" FOREIGN KEY ("reportedBy") REFERENCES "app_user"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_markedBy_fkey" FOREIGN KEY ("markedBy") REFERENCES "app_user"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_assignment" ADD CONSTRAINT "work_assignment_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "app_user"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_assignment" ADD CONSTRAINT "work_assignment_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "app_user"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_assignment" ADD CONSTRAINT "work_assignment_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "area"("areaId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_assignment" ADD CONSTRAINT "work_assignment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batch"("batchId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_assignment" ADD CONSTRAINT "work_assignment_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "stage"("stageId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_assignment" ADD CONSTRAINT "work_assignment_benchId_fkey" FOREIGN KEY ("benchId") REFERENCES "bench"("benchId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_assignment" ADD CONSTRAINT "work_assignment_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "media_recipe"("recipeId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entry" ADD CONSTRAINT "production_entry_assignId_fkey" FOREIGN KEY ("assignId") REFERENCES "work_assignment"("assignId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entry" ADD CONSTRAINT "production_entry_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "app_user"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entry" ADD CONSTRAINT "production_entry_enteredBy_fkey" FOREIGN KEY ("enteredBy") REFERENCES "app_user"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entry" ADD CONSTRAINT "production_entry_verifiedBy_fkey" FOREIGN KEY ("verifiedBy") REFERENCES "app_user"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entry" ADD CONSTRAINT "production_entry_trayId_fkey" FOREIGN KEY ("trayId") REFERENCES "tray"("trayId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entry" ADD CONSTRAINT "production_entry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batch"("batchId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entry" ADD CONSTRAINT "production_entry_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "stage"("stageId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entry" ADD CONSTRAINT "production_entry_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "area"("areaId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entry" ADD CONSTRAINT "production_entry_mediaLotId_fkey" FOREIGN KEY ("mediaLotId") REFERENCES "media_lot"("mediaLotId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entry" ADD CONSTRAINT "production_entry_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "tray_movement"("movementId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entry" ADD CONSTRAINT "production_entry_contId_fkey" FOREIGN KEY ("contId") REFERENCES "contamination"("contId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_txn" ADD CONSTRAINT "stock_txn_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("itemId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_txn" ADD CONSTRAINT "stock_txn_mediaLotId_fkey" FOREIGN KEY ("mediaLotId") REFERENCES "media_lot"("mediaLotId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_txn" ADD CONSTRAINT "stock_txn_doneBy_fkey" FOREIGN KEY ("doneBy") REFERENCES "app_user"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_lot" ADD CONSTRAINT "media_lot_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "media_recipe"("recipeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_lot" ADD CONSTRAINT "media_lot_preparedBy_fkey" FOREIGN KEY ("preparedBy") REFERENCES "app_user"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_entry" ADD CONSTRAINT "cost_entry_enteredBy_fkey" FOREIGN KEY ("enteredBy") REFERENCES "app_user"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "crop"("cropId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "app_user"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "sales_order"("orderId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batch"("batchId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_enteredBy_fkey" FOREIGN KEY ("enteredBy") REFERENCES "app_user"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_device" ADD CONSTRAINT "sensor_device_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "area"("areaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_reading" ADD CONSTRAINT "sensor_reading_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "sensor_device"("deviceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "area"("areaId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_ackBy_fkey" FOREIGN KEY ("ackBy") REFERENCES "app_user"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("userId") ON DELETE SET NULL ON UPDATE CASCADE;
