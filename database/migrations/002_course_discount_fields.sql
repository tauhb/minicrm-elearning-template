-- Migration 002: Add discount/promotional price fields to courses table
-- Run this in Supabase SQL editor

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS discount_price INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS discount_from  TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS discount_to    TIMESTAMPTZ DEFAULT NULL;
