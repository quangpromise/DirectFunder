-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "avatarColor" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cases" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "clients" JSONB NOT NULL,
    "clientLink" TEXT,
    "zipcode" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "descriptionReplies" JSONB NOT NULL DEFAULT '[]',
    "descriptionReadBy" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "caseNumber" TEXT NOT NULL,
    "money" DOUBLE PRECISION NOT NULL,
    "orders" JSONB NOT NULL DEFAULT '[]',
    "ssn" JSONB NOT NULL,
    "assignedTo" TEXT,
    "assignedProcessor" TEXT,
    "custom" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "columns" JSONB NOT NULL,
    "featurePermissions" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "cases_caseNumber_key" ON "cases"("caseNumber");
