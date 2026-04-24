import { describe, expect, it } from "vitest";

import {
  extractTelemetryImagePayload,
  isTelemetryImageField,
} from "../../../../../renderer/components/editors/telemetry/utils/telemetry-image";
import type {
  ITelemetryField,
  ITelemetryModel,
} from "../../../../../renderer/data-sources/telemetry";

const model: ITelemetryModel = {
  workloads: [],
  raw: null,
  schemaSessionId: "sid",
  workloads_buffer_size_used: 0,
  process_memory_used: 0,
};

function field(overrides: Partial<ITelemetryField>): ITelemetryField {
  return {
    name: "image",
    type: "Image",
    path: "camera.outputs.image",
    offset: 0,
    elementCount: 1,
    model,
    getValue: () => undefined,
    ...overrides,
  };
}

describe("telemetry image helpers", () => {
  it("recognizes and extracts encoded Image structs using metadata pixel_format", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xaa, 0xd9, 0x00]);
    const imageField = field({
      fields: [
        field({ name: "metadata", path: "camera.outputs.image.metadata" }),
        field({ name: "count", path: "camera.outputs.image.count" }),
        field({
          name: "data_buffer",
          path: "camera.outputs.image.data_buffer",
          type: "ImageByte",
          mime_type: "application/octet-stream",
        }),
      ],
      getValue: () => ({
        metadata: { pixel_format: 8 },
        count: 4,
        data_buffer: bytes,
      }),
    });

    expect(isTelemetryImageField(imageField)).toBe(true);
    const payload = extractTelemetryImagePayload(imageField);
    expect(payload?.mime).toBe("image/jpeg");
    expect(Array.from(payload?.bytes ?? [])).toEqual([0xff, 0xd8, 0xaa, 0xd9]);
  });

  it("keeps legacy image byte fields working from explicit mime_type", () => {
    const imageField = field({
      name: "data_buffer",
      type: "ImageByte",
      path: "camera.outputs.image.data_buffer",
      mime_type: "image/png",
      getValue: () =>
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });

    expect(isTelemetryImageField(imageField)).toBe(true);
    expect(extractTelemetryImagePayload(imageField)?.mime).toBe("image/png");
  });

  it("treats explicit image MIME strings case-insensitively", () => {
    const imageField = field({
      mime_type: " Image/JPEG ",
      getValue: () => new Uint8Array([0xff, 0xd8, 0xaa, 0xd9]),
    });

    expect(isTelemetryImageField(imageField)).toBe(true);
    expect(extractTelemetryImagePayload(imageField)?.mime).toBe(" Image/JPEG ");
  });

  it("treats metadata pixel formats case-insensitively", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xaa, 0xd9, 0x00]);
    const imageField = field({
      fields: [
        field({ name: "metadata", path: "camera.outputs.image.metadata" }),
        field({ name: "count", path: "camera.outputs.image.count" }),
        field({
          name: "data_buffer",
          path: "camera.outputs.image.data_buffer",
          type: "ImageByte",
        }),
      ],
      getValue: () => ({
        metadata: { pixel_format: " jpeg " },
        count: 4,
        data_buffer: bytes,
      }),
    });

    expect(extractTelemetryImagePayload(imageField)?.mime).toBe("image/jpeg");
  });
});
