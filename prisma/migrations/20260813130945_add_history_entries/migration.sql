-- CreateTable
CREATE TABLE "edit_history_entries" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "ssn" TEXT,
    "clientName" TEXT NOT NULL,
    "fieldLabel" TEXT NOT NULL,
    "oldValue" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "editedByUserId" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edit_history_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deleted_row_entries" (
    "id" TEXT NOT NULL,
    "caseSnapshot" JSONB NOT NULL,
    "deletedByUserId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deleted_row_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "edit_history_entries_editedAt_idx" ON "edit_history_entries"("editedAt");

-- CreateIndex
CREATE INDEX "deleted_row_entries_deletedAt_idx" ON "deleted_row_entries"("deletedAt");
