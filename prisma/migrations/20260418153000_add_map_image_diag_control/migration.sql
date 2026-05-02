CREATE TABLE "MapImageDiagControl" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "fullCaptureEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapImageDiagControl_pkey" PRIMARY KEY ("id")
);
