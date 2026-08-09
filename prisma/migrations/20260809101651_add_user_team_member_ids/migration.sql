-- AlterTable
ALTER TABLE "users" ADD COLUMN     "teamMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
