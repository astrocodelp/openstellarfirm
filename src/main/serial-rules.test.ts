import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  chosenPortId,
  isOwnPage,
  isPetBoard,
  petBoards,
  pickSerialPort,
  serialDeviceAllowed,
  serialPermissionAllowed,
} from "./serial-rules";

const pageUrl = pathToFileURL(join("/app", "renderer", "index.html")).href;
const packaged = { pageUrl, devUrl: undefined, packaged: true };
const dev = {
  pageUrl,
  devUrl: "http://localhost:5173/",
  packaged: false,
};

const ask = (over: Partial<Parameters<typeof serialPermissionAllowed>[0]>) => ({
  permission: "serial",
  requestingUrl: pageUrl,
  isMainFrame: true,
  fromMainWindow: true,
  ...over,
});

describe("the serial permission", () => {
  it("is given to the app's own page in its main frame", () => {
    expect(serialPermissionAllowed(ask({}), packaged)).toBe(true);
    expect(
      serialPermissionAllowed(
        ask({ requestingUrl: `${pageUrl}#/x` }),
        packaged,
      ),
    ).toBe(true);
  });

  it("is given to the dev server only when the app runs from source", () => {
    const url = "http://localhost:5173/index.html";
    expect(serialPermissionAllowed(ask({ requestingUrl: url }), dev)).toBe(
      true,
    );
    expect(serialPermissionAllowed(ask({ requestingUrl: url }), packaged)).toBe(
      false,
    );
    expect(
      serialPermissionAllowed(
        ask({ requestingUrl: "http://localhost:9999/" }),
        dev,
      ),
    ).toBe(false);
  });

  it("is refused for every other permission", () => {
    for (const permission of [
      "media",
      "geolocation",
      "notifications",
      "clipboard-read",
      "hid",
      "usb",
      "midi",
      "fullscreen",
      "openExternal",
      "",
    ]) {
      expect(
        serialPermissionAllowed(ask({ permission }), packaged),
        permission,
      ).toBe(false);
    }
  });

  it("is refused for another page, a frame, an unknown ask or another window", () => {
    for (const requestingUrl of [
      undefined,
      "",
      "https://example.com/",
      "file:///etc/passwd",
      pathToFileURL(join("/app", "renderer", "other.html")).href,
      "data:text/html,hi",
      "not a url",
    ]) {
      expect(
        serialPermissionAllowed(ask({ requestingUrl }), packaged),
        String(requestingUrl),
      ).toBe(false);
    }
    expect(serialPermissionAllowed(ask({ isMainFrame: false }), packaged)).toBe(
      false,
    );
    expect(
      serialPermissionAllowed(ask({ isMainFrame: undefined }), packaged),
    ).toBe(false);
    expect(
      serialPermissionAllowed(ask({ fromMainWindow: false }), packaged),
    ).toBe(false);
  });

  it("knows the app's own page", () => {
    expect(isOwnPage(pageUrl, packaged)).toBe(true);
    expect(isOwnPage(undefined, packaged)).toBe(false);
  });
});

describe("the boards the page may see", () => {
  const nano = {
    portId: "a",
    portName: "ttyACM0",
    vendorId: "9025",
    productId: "112",
  };

  it("are the Arduino Nano ESP32 and nothing else", () => {
    expect(isPetBoard(nano)).toBe(true);
    expect(isPetBoard({ vendorId: 0x2341, productId: 0x0070 })).toBe(true);
    expect(isPetBoard({ vendorId: "0x2341", productId: "0x0070" })).toBe(true);
    expect(isPetBoard({ vendorId: "9025", productId: "113" })).toBe(false);
    expect(isPetBoard({ vendorId: "4292", productId: "60000" })).toBe(false);
    expect(isPetBoard({})).toBe(false);
    expect(isPetBoard(undefined)).toBe(false);
    expect(isPetBoard({ vendorId: "9025x", productId: "112" })).toBe(false);
  });

  it("are the only serial devices the device handler allows", () => {
    expect(serialDeviceAllowed({ deviceType: "serial", device: nano })).toBe(
      true,
    );
    expect(
      serialDeviceAllowed({
        deviceType: "serial",
        device: { vendorId: "1", productId: "2" },
      }),
    ).toBe(false);
    expect(serialDeviceAllowed({ deviceType: "hid", device: nano })).toBe(
      false,
    );
    expect(serialDeviceAllowed({ deviceType: "usb", device: nano })).toBe(
      false,
    );
    expect(serialDeviceAllowed({ deviceType: "serial", device: null })).toBe(
      false,
    );
  });

  it("are listed by name and port id, other ports left out", () => {
    const list = [
      nano,
      {
        portId: "b",
        portName: "ttyUSB0",
        vendorId: "4292",
        productId: "60000",
      },
      {
        portId: "c",
        displayName: "Nano ESP32",
        vendorId: "9025",
        productId: "112",
      },
      { vendorId: "9025", productId: "112" },
    ];
    expect(petBoards(list)).toEqual([
      { portId: "a", name: "ttyACM0" },
      { portId: "c", name: "Nano ESP32" },
    ]);
  });

  it("are picked on their own when there is one, asked about when many, and refused when none", () => {
    expect(pickSerialPort([])).toEqual({ kind: "none" });
    expect(
      pickSerialPort([{ portId: "b", vendorId: "4292", productId: "60000" }]),
    ).toEqual({ kind: "none" });
    expect(pickSerialPort([nano])).toEqual({ kind: "one", portId: "a" });
    expect(pickSerialPort([nano, { ...nano, portId: "c" }])).toMatchObject({
      kind: "many",
    });
  });

  it("take an answer only when it names a board that was offered", () => {
    const boards = [{ portId: "a", name: "x" }];
    expect(chosenPortId(boards, "a")).toBe("a");
    expect(chosenPortId(boards, "z")).toBe("");
    expect(chosenPortId(boards, null)).toBe("");
    expect(chosenPortId(boards, 3)).toBe("");
  });
});
