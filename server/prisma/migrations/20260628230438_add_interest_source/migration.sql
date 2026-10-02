-- AlterTable
ALTER TABLE "FacultyResearchInterest" ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'scraped';
