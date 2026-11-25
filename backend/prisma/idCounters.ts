// Every table whose id is a counter. After rows are added with their own ids (the sample data),
// each counter must be moved past the highest id, or the next new row would reuse an id.
import type { PrismaClient } from '@prisma/client';

export const ID_TABLES: [string, string][] = [
  ['lab', 'labId'], ['area', 'areaId'], ['bench', 'benchId'], ['app_user', 'userId'], ['crop', 'cropId'], ['stage', 'stageId'],
  ['media_recipe', 'recipeId'], ['alert_rule', 'ruleId'], ['batch', 'batchId'], ['sample', 'sampleId'], ['media_lot', 'mediaLotId'],
  ['tray', 'trayId'], ['tray_movement', 'movementId'], ['contamination', 'contId'], ['attendance', 'attId'], ['work_assignment', 'assignId'],
  ['production_entry', 'entryId'], ['item', 'itemId'], ['stock_txn', 'txnId'], ['cost_entry', 'costId'], ['sales_order', 'orderId'],
  ['delivery', 'deliveryId'], ['sensor_device', 'deviceId'], ['alert', 'alertId'], ['audit_log', 'auditId'], ['password_reset', 'resetId'],
];

export async function fixIdCounters(prisma: PrismaClient) {
  for (const [table, id] of ID_TABLES) {
    // The table name is quoted as an identifier; the column name is passed as plain text (Postgres keeps its case).
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${table}"', '${id}'), COALESCE((SELECT MAX("${id}") FROM "${table}"), 0) + 1, false)`,
    );
  }
}
