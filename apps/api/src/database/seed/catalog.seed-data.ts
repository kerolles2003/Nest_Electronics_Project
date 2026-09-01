/**
 * Development seed data for the public catalogue.
 *
 * NOT a migration. The frozen architecture is explicit that the system starts
 * from a CLEAN DATABASE with no legacy import (ARCHITECTURE-FREEZE-RATIFICATION
 * C1), so nothing here corresponds to a legacy row. It exists so the API, the
 * Swagger document and the Flutter client have realistic data to work against.
 *
 * The shape of the data is deliberately awkward in the ways the real catalogue
 * is awkward, because a seed that is too tidy hides bugs:
 *   · many products have NO brand, and one brand has no products at all
 *   · many products have NO image (74% of live products have none), some have
 *     exactly one, and some have a gallery of three
 *   · some products are out of stock, some are below their low-stock threshold
 *   · some carry a sale price, most do not
 *   · some have no reviews yet, so the rating widget must render nothing
 *   · the category tree is three levels deep in one branch and one level deep
 *     in most, so a breadcrumb cannot assume a fixed depth
 *   · prices span four orders of magnitude (1.00 EGP to 14,500.00 EGP)
 *
 * ## Why it was extended for Phase 4 (T1)
 *
 * The storefront pages being moved onto the API render states this seed could
 * not produce. With zero images in the whole catalogue, the product gallery,
 * the thumbnail strip and the `images.length > 1` branch were unreachable, so a
 * migration could break every one of them and still look correct. Same for the
 * "no reviews yet" rating, the empty brand page, and a breadcrumb deeper than
 * two levels.
 *
 * The seed is TEST INFRASTRUCTURE, not business data (D-6): the real catalogue
 * does not exist and arrives later from a supplier feed. Extending it is
 * therefore free of business consequence and is the only way the T1 acceptance
 * criterion — structural parity, every state still handled — can be checked at
 * all.
 *
 * ## Images name a PROVIDER-RELATIVE identifier, never a URL
 *
 * `MEDIA-MODEL.md` §3 is explicit: persist `publicId` + `version`, derive URLs
 * at read time. The legacy system stored absolute URLs and deleted assets by
 * string-splitting them, which made a CDN change a data migration. These
 * `publicId`s sit in the same `nest/products/<slug>/<n>` namespace the media
 * upload API writes to, so the rendering path exercised here is the one real
 * uploads will use. Until a Cloudinary account is configured they resolve to
 * nothing and the storefront renders its placeholder — which is correct
 * behaviour, and still drives the layout from real image COUNTS.
 *
 * All money is in integer minor units (piastres): 32500 = 325.00 EGP.
 */

export interface SeedCategory {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly parentSlug: string | null;
  readonly sortOrder: number;
}

export interface SeedBrand {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly website: string | null;
}

/**
 * An image record as the media pipeline will persist it.
 *
 * `bytes`, `width` and `height` are captured at upload rather than guessed at
 * render time — legacy stored none of the three, which guaranteed layout shift
 * on every product grid.
 */
export interface SeedImage {
  readonly publicId: string;
  readonly version: number;
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly alt: string | null;
}

/**
 * One image for a product, in the namespace the upload API writes to.
 *
 * The dimensions vary on purpose: a grid that only ever sees 1200x1200 squares
 * will not reveal that it cannot cope with a landscape photograph.
 */
const image = (
  slug: string,
  index: number,
  alt: string,
  width = 1200,
  height = 1200,
): SeedImage => ({
  publicId: `nest/products/${slug}/${String(index)}`,
  version: 1756700000,
  format: 'webp',
  width,
  height,
  bytes: 40_000 + index * 9_000,
  alt,
});

export interface SeedSpec {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly unit: string | null;
  readonly filterable: boolean;
}

export interface SeedProduct {
  readonly sku: string;
  readonly slug: string;
  readonly name: string;
  readonly shortDescription: string;
  readonly description: string;
  readonly categorySlug: string;
  readonly brandSlug: string | null;
  readonly basePrice: number;
  readonly salePrice: number | null;
  readonly costPrice: number | null;
  readonly onHand: number;
  readonly lowStockThreshold: number;
  readonly isFeatured: boolean;
  readonly salesCount: number;
  /** Mean score in hundredths (430 = 4.30), and the number of reviews. */
  readonly ratingAverage: number;
  readonly ratingCount: number;
  readonly weight: number | null;
  readonly specs: readonly SeedSpec[];
  /**
   * OPTIONAL, and absent for most products on purpose.
   *
   * "No images" is the majority state in a real catalogue and it is a state the
   * storefront has to render correctly, so it is the default here rather than
   * something a test has to construct. The first entry becomes the primary
   * image; order is the array order.
   */
  readonly images?: readonly SeedImage[];
}

export const SEED_CATEGORIES: readonly SeedCategory[] = [
  { slug: 'microcontrollers', name: 'Microcontrollers', description: 'Boards and modules built around a microcontroller or SoC.', parentSlug: null, sortOrder: 1 },
  { slug: 'development-boards', name: 'Development Boards', description: 'Ready-to-flash boards with USB, regulator and headers.', parentSlug: 'microcontrollers', sortOrder: 1 },
  { slug: 'mcu-modules', name: 'MCU Modules', description: 'Bare modules for integration into your own PCB.', parentSlug: 'microcontrollers', sortOrder: 2 },

  { slug: 'sensors', name: 'Sensors', description: 'Measure the physical world.', parentSlug: null, sortOrder: 2 },
  { slug: 'environmental-sensors', name: 'Environmental Sensors', description: 'Temperature, humidity, pressure and air quality.', parentSlug: 'sensors', sortOrder: 1 },
  { slug: 'motion-sensors', name: 'Motion & Distance Sensors', description: 'Accelerometers, gyroscopes, ultrasonic and PIR.', parentSlug: 'sensors', sortOrder: 2 },
  // The only depth-2 category, and it exists for exactly that reason: a
  // breadcrumb, a category page and the subtree filter must all cope with a
  // branch deeper than the one they were written against.
  { slug: 'imu-modules', name: 'IMU Modules', description: 'Combined accelerometer, gyroscope and magnetometer packages.', parentSlug: 'motion-sensors', sortOrder: 1 },

  { slug: 'passive-components', name: 'Passive Components', description: 'The parts every build needs.', parentSlug: null, sortOrder: 3 },
  { slug: 'resistors', name: 'Resistors', description: 'Through-hole and surface-mount resistors and kits.', parentSlug: 'passive-components', sortOrder: 1 },
  { slug: 'capacitors', name: 'Capacitors', description: 'Ceramic, electrolytic and tantalum capacitors.', parentSlug: 'passive-components', sortOrder: 2 },

  { slug: 'power', name: 'Power & Batteries', description: 'Cells, chargers, regulators and supplies.', parentSlug: null, sortOrder: 4 },
  { slug: 'connectivity', name: 'Connectivity', description: 'Radio, cellular and wired communication modules.', parentSlug: null, sortOrder: 5 },
  { slug: 'tools', name: 'Tools & Equipment', description: 'Soldering, measurement and bench equipment.', parentSlug: null, sortOrder: 6 },
];

export const SEED_BRANDS: readonly SeedBrand[] = [
  { slug: 'espressif', name: 'Espressif', description: 'Wi-Fi and Bluetooth SoCs — the ESP32 and ESP8266 families.', website: 'https://www.espressif.com' },
  { slug: 'arduino', name: 'Arduino', description: 'Open-source boards and the toolchain that made embedded approachable.', website: 'https://www.arduino.cc' },
  { slug: 'raspberry-pi', name: 'Raspberry Pi', description: 'Single-board computers and the RP2040 microcontroller.', website: 'https://www.raspberrypi.com' },
  { slug: 'waveshare', name: 'Waveshare', description: 'Breakout boards, displays and HATs.', website: 'https://www.waveshare.com' },
  { slug: 'dfrobot', name: 'DFRobot', description: 'Sensor modules and robotics components.', website: 'https://www.dfrobot.com' },
  { slug: 'nordic-semiconductor', name: 'Nordic Semiconductor', description: 'Bluetooth Low Energy and short-range wireless SoCs.', website: 'https://www.nordicsemi.com' },
  // Deliberately stocks NOTHING. A brand record created before its first
  // delivery is ordinary, and `/brands/sparkfun` rendering an empty state
  // rather than a crash or a blank page is a case no other row can produce.
  { slug: 'sparkfun', name: 'SparkFun', description: 'Breakout boards and Qwiic-connected modules.', website: 'https://www.sparkfun.com' },
];

const V = (value: string): SeedSpec => ({ key: 'operating-voltage', label: 'Operating Voltage', value, unit: 'V', filterable: true });
const CONN = (value: string): SeedSpec => ({ key: 'connectivity', label: 'Connectivity', value, unit: null, filterable: true });
const IFACE = (value: string): SeedSpec => ({ key: 'interface', label: 'Interface', value, unit: null, filterable: true });
const MOUNT = (value: string): SeedSpec => ({ key: 'mounting', label: 'Mounting', value, unit: null, filterable: true });
const spec = (key: string, label: string, value: string, unit: string | null = null): SeedSpec => ({ key, label, value, unit, filterable: false });

export const SEED_PRODUCTS: readonly SeedProduct[] = [
  {
    sku: 'ESP32-DEVKIT-V1', slug: 'esp32-devkit-v1', name: 'ESP32 DevKit V1',
    shortDescription: 'Dual-core Wi-Fi and Bluetooth development board with 30 pins.',
    description: 'The ESP32 DevKit V1 pairs a dual-core Xtensa LX6 running at 240 MHz with Wi-Fi and Bluetooth on a breadboard-friendly 30-pin module. It exposes 25 GPIO, two ADCs, touch inputs and hardware SPI, I2C and UART, and flashes over USB with no external programmer. The default choice for connected projects.',
    categorySlug: 'development-boards', brandSlug: 'espressif',
    basePrice: 32500, salePrice: 28000, costPrice: 21000,
    onHand: 149, lowStockThreshold: 10, isFeatured: true, salesCount: 214,
    ratingAverage: 456, ratingCount: 38, weight: 9,
    images: [
      image('esp32-devkit-v1', 1, 'ESP32 DevKit V1 board, top view'),
      image('esp32-devkit-v1', 2, 'ESP32 DevKit V1 pin labels', 1600, 900),
      image('esp32-devkit-v1', 3, 'ESP32 DevKit V1 in a breadboard'),
    ],
    specs: [V('3.3'), CONN('Wi-Fi + Bluetooth'), IFACE('USB'), MOUNT('Through-hole'), spec('cpu-cores', 'CPU Cores', '2'), spec('clock-speed', 'Clock Speed', '240', 'MHz'), spec('flash', 'Flash', '4', 'MB')],
  },
  {
    sku: 'ESP32-S3-DEVKITC-1', slug: 'esp32-s3-devkitc-1', name: 'ESP32-S3-DevKitC-1',
    shortDescription: 'ESP32-S3 board with native USB and vector instructions for AI workloads.',
    description: 'The ESP32-S3-DevKitC-1 adds native USB OTG, vector instructions for lightweight neural inference and 45 GPIO to the ESP32 line. Wi-Fi and Bluetooth 5 LE are on board, along with 8 MB of flash and PSRAM.',
    categorySlug: 'development-boards', brandSlug: 'espressif',
    basePrice: 61500, salePrice: null, costPrice: 44000,
    onHand: 42, lowStockThreshold: 10, isFeatured: true, salesCount: 61,
    ratingAverage: 470, ratingCount: 17, weight: 11,
    images: [
      image('esp32-s3-devkitc-1', 1, 'ESP32-S3-DevKitC-1, top view'),
      image('esp32-s3-devkitc-1', 2, 'ESP32-S3-DevKitC-1 USB-C end', 1600, 900),
    ],
    specs: [V('3.3'), CONN('Wi-Fi + Bluetooth'), IFACE('USB-C'), MOUNT('Through-hole'), spec('flash', 'Flash', '8', 'MB'), spec('psram', 'PSRAM', '8', 'MB')],
  },
  {
    sku: 'ESP8266-NODEMCU-V3', slug: 'esp8266-nodemcu-v3', name: 'NodeMCU V3 (ESP8266)',
    shortDescription: 'Low-cost Wi-Fi board for simple connected projects.',
    description: 'The NodeMCU V3 remains the cheapest reliable way to put a project on Wi-Fi. A single-core 80 MHz ESP8266, 4 MB of flash, 11 usable GPIO and one 10-bit ADC, programmable over micro-USB.',
    categorySlug: 'development-boards', brandSlug: 'espressif',
    basePrice: 19000, salePrice: 16500, costPrice: 12000,
    onHand: 88, lowStockThreshold: 15, isFeatured: false, salesCount: 176,
    ratingAverage: 412, ratingCount: 29, weight: 10,
    specs: [V('3.3'), CONN('Wi-Fi'), IFACE('Micro-USB'), MOUNT('Through-hole'), spec('flash', 'Flash', '4', 'MB')],
  },
  {
    sku: 'ESP32-WROOM-32', slug: 'esp32-wroom-32-module', name: 'ESP32-WROOM-32 Module',
    shortDescription: 'Bare castellated module for integration into your own board.',
    description: 'The ESP32-WROOM-32 is the module the DevKit boards are built around, supplied bare with a PCB antenna and castellated edge pads. Intended for reflow onto a custom PCB.',
    categorySlug: 'mcu-modules', brandSlug: 'espressif',
    basePrice: 14500, salePrice: null, costPrice: 10500,
    onHand: 63, lowStockThreshold: 20, isFeatured: false, salesCount: 47,
    ratingAverage: 440, ratingCount: 8, weight: 3,
    specs: [V('3.3'), CONN('Wi-Fi + Bluetooth'), MOUNT('Surface-mount'), spec('flash', 'Flash', '4', 'MB')],
  },
  {
    sku: 'ARDUINO-UNO-R3', slug: 'arduino-uno-r3', name: 'Arduino Uno R3',
    shortDescription: 'The reference 8-bit board. Shields, tutorials and forgiving 5 V I/O.',
    description: 'The Arduino Uno R3 is the board almost every tutorial assumes. An ATmega328P at 16 MHz, 14 digital pins, 6 analogue inputs and a 5 V logic level tolerant of the wiring mistakes beginners actually make. Compatible with the largest shield ecosystem in the hobby.',
    categorySlug: 'development-boards', brandSlug: 'arduino',
    basePrice: 78000, salePrice: null, costPrice: 58000,
    onHand: 34, lowStockThreshold: 8, isFeatured: true, salesCount: 132,
    ratingAverage: 481, ratingCount: 54, weight: 25,
    images: [
      image('arduino-uno-r3', 1, 'Arduino Uno R3, top view'),
      image('arduino-uno-r3', 2, 'Arduino Uno R3 headers'),
      image('arduino-uno-r3', 3, 'Arduino Uno R3 with a shield fitted', 900, 1600),
    ],
    specs: [V('5'), IFACE('USB-B'), MOUNT('Through-hole'), spec('clock-speed', 'Clock Speed', '16', 'MHz'), spec('flash', 'Flash', '32', 'KB')],
  },
  {
    sku: 'ARDUINO-NANO-V3', slug: 'arduino-nano-v3', name: 'Arduino Nano V3',
    shortDescription: 'Uno capability in a breadboard-width footprint.',
    description: 'The same ATmega328P as the Uno in a 18 × 45 mm board that drops straight into a breadboard. Eight analogue inputs rather than six, at the cost of the shield ecosystem.',
    categorySlug: 'development-boards', brandSlug: 'arduino',
    basePrice: 41000, salePrice: 36500, costPrice: 29000,
    onHand: 57, lowStockThreshold: 10, isFeatured: false, salesCount: 98,
    ratingAverage: 445, ratingCount: 31, weight: 7,
    specs: [V('5'), IFACE('Mini-USB'), MOUNT('Through-hole'), spec('clock-speed', 'Clock Speed', '16', 'MHz')],
  },
  {
    sku: 'ARDUINO-MEGA-2560', slug: 'arduino-mega-2560', name: 'Arduino Mega 2560',
    shortDescription: '54 digital pins and 4 hardware serial ports for larger builds.',
    description: 'When an Uno runs out of pins, the Mega 2560 is the answer: 54 digital I/O, 16 analogue inputs, four hardware UARTs and 256 KB of flash. The usual choice for 3D printer controllers and multi-sensor rigs.',
    categorySlug: 'development-boards', brandSlug: 'arduino',
    basePrice: 132000, salePrice: null, costPrice: 98000,
    onHand: 12, lowStockThreshold: 5, isFeatured: false, salesCount: 41,
    ratingAverage: 462, ratingCount: 19, weight: 37,
    specs: [V('5'), IFACE('USB-B'), MOUNT('Through-hole'), spec('flash', 'Flash', '256', 'KB')],
  },
  {
    sku: 'RPI-PICO-W', slug: 'raspberry-pi-pico-w', name: 'Raspberry Pi Pico W',
    shortDescription: 'RP2040 with Wi-Fi, programmable in C or MicroPython.',
    description: 'The Pico W adds an Infineon CYW43439 Wi-Fi radio to the RP2040 dual-core Cortex-M0+. Its eight programmable I/O state machines let it bit-bang protocols no other board at this price can handle.',
    categorySlug: 'development-boards', brandSlug: 'raspberry-pi',
    basePrice: 29500, salePrice: null, costPrice: 21500,
    onHand: 96, lowStockThreshold: 15, isFeatured: true, salesCount: 187,
    ratingAverage: 474, ratingCount: 44, weight: 6,
    specs: [V('3.3'), CONN('Wi-Fi'), IFACE('Micro-USB'), MOUNT('Through-hole'), spec('cpu-cores', 'CPU Cores', '2'), spec('flash', 'Flash', '2', 'MB')],
  },
  {
    sku: 'RPI-4B-4GB', slug: 'raspberry-pi-4-model-b-4gb', name: 'Raspberry Pi 4 Model B (4 GB)',
    shortDescription: 'Quad-core single-board computer with gigabit Ethernet and dual HDMI.',
    description: 'A full Linux computer at 4 GB of LPDDR4: quad-core Cortex-A72 at 1.8 GHz, gigabit Ethernet, USB 3.0, dual micro-HDMI and the 40-pin GPIO header. The bridge between embedded work and a real operating system.',
    categorySlug: 'development-boards', brandSlug: 'raspberry-pi',
    basePrice: 385000, salePrice: null, costPrice: 310000,
    onHand: 3, lowStockThreshold: 5, isFeatured: false, salesCount: 22,
    ratingAverage: 488, ratingCount: 26, weight: 46,
    images: [
      image('raspberry-pi-4-model-b-4gb', 1, 'Raspberry Pi 4 Model B, top view'),
    ],
    specs: [V('5'), CONN('Wi-Fi + Bluetooth + Ethernet'), IFACE('USB-C'), spec('ram', 'RAM', '4', 'GB')],
  },
  {
    sku: 'NRF52840-DONGLE', slug: 'nrf52840-dongle', name: 'nRF52840 USB Dongle',
    shortDescription: 'Bluetooth 5 LE, Thread and Zigbee in a USB stick.',
    description: 'A ready-made USB radio for Bluetooth Low Energy, Thread, Zigbee and 802.15.4 development and sniffing. Programmable over USB with no debugger, and widely used as a Zigbee coordinator.',
    categorySlug: 'mcu-modules', brandSlug: 'nordic-semiconductor',
    basePrice: 96000, salePrice: null, costPrice: 74000,
    onHand: 0, lowStockThreshold: 4, isFeatured: false, salesCount: 15,
    ratingAverage: 450, ratingCount: 6, weight: 8,
    specs: [V('3.3'), CONN('Bluetooth + Zigbee + Thread'), IFACE('USB-A'), MOUNT('Through-hole')],
  },
  {
    sku: 'DHT22-AM2302', slug: 'dht22-temperature-humidity-sensor', name: 'DHT22 Temperature & Humidity Sensor',
    shortDescription: 'Single-wire digital temperature and humidity, calibrated.',
    description: 'The DHT22 (AM2302) reports temperature from -40 to 80 °C at ±0.5 °C and relative humidity from 0 to 100% at ±2%, over a single data line. Slower than a BME280 but easier to wire and far more tolerant of long cable runs.',
    categorySlug: 'environmental-sensors', brandSlug: null,
    basePrice: 12500, salePrice: null, costPrice: 8500,
    onHand: 74, lowStockThreshold: 12, isFeatured: false, salesCount: 143,
    ratingAverage: 398, ratingCount: 47, weight: 5,
    specs: [V('3.3'), IFACE('1-Wire'), MOUNT('Through-hole'), spec('range-temperature', 'Temperature Range', '-40 to 80', '°C'), spec('accuracy', 'Accuracy', '±0.5', '°C')],
  },
  {
    sku: 'BME280-BREAKOUT', slug: 'bme280-pressure-sensor', name: 'BME280 Pressure, Humidity & Temperature Breakout',
    shortDescription: 'Three environmental measurements over I2C or SPI.',
    description: 'The Bosch BME280 combines barometric pressure, humidity and temperature in one package with enough precision to resolve about a metre of altitude. The breakout adds a 3.3 V regulator and level shifting so it works with 5 V boards.',
    categorySlug: 'environmental-sensors', brandSlug: 'waveshare',
    basePrice: 23500, salePrice: null, costPrice: 16000,
    onHand: 31, lowStockThreshold: 10, isFeatured: false, salesCount: 66,
    ratingAverage: 468, ratingCount: 23, weight: 3,
    images: [
      image('bme280-pressure-sensor', 1, 'BME280 breakout board'),
      image('bme280-pressure-sensor', 2, 'BME280 breakout, underside'),
    ],
    specs: [V('3.3'), IFACE('I2C'), MOUNT('Through-hole'), spec('range-pressure', 'Pressure Range', '300 to 1100', 'hPa')],
  },
  {
    sku: 'DS18B20-WATERPROOF', slug: 'ds18b20-waterproof-probe', name: 'DS18B20 Waterproof Temperature Probe',
    shortDescription: 'Stainless-steel 1-Wire probe on a 1 m lead.',
    description: 'A DS18B20 sealed into a stainless probe with a metre of cable — the standard answer for water, soil and outdoor temperature. Many probes share one data pin, each addressed by its unique 64-bit ROM code.',
    categorySlug: 'environmental-sensors', brandSlug: null,
    basePrice: 8500, salePrice: 7200, costPrice: 5500,
    onHand: 120, lowStockThreshold: 20, isFeatured: false, salesCount: 91,
    ratingAverage: 455, ratingCount: 33, weight: 40,
    specs: [V('3.3'), IFACE('1-Wire'), spec('range-temperature', 'Temperature Range', '-55 to 125', '°C'), spec('cable-length', 'Cable Length', '1', 'm')],
  },
  {
    sku: 'HC-SR04', slug: 'hc-sr04-ultrasonic-sensor', name: 'HC-SR04 Ultrasonic Distance Sensor',
    shortDescription: '2 cm to 4 m distance measurement for a few pounds.',
    description: 'The HC-SR04 fires a 40 kHz burst and times the echo. Two pins, no library required, 3 mm resolution from 2 cm to 4 m. The most-built sensor project in the hobby, and still the right answer for obstacle avoidance.',
    categorySlug: 'motion-sensors', brandSlug: null,
    basePrice: 4500, salePrice: null, costPrice: 2800,
    onHand: 210, lowStockThreshold: 30, isFeatured: true, salesCount: 388,
    ratingAverage: 421, ratingCount: 76, weight: 9,
    specs: [V('5'), IFACE('GPIO'), MOUNT('Through-hole'), spec('range-distance', 'Measuring Range', '0.02 to 4', 'm')],
  },
  {
    sku: 'MPU6050-GY521', slug: 'mpu6050-6-axis-imu', name: 'MPU-6050 6-Axis IMU (GY-521)',
    shortDescription: 'Three-axis accelerometer and gyroscope on one I2C address.',
    description: 'The MPU-6050 combines a 3-axis accelerometer and 3-axis gyroscope with an on-chip motion processor that can fuse them without troubling your microcontroller. The GY-521 breakout adds a regulator and pull-ups.',
    categorySlug: 'motion-sensors', brandSlug: 'dfrobot',
    basePrice: 9500, salePrice: 7900, costPrice: 6200,
    onHand: 65, lowStockThreshold: 12, isFeatured: false, salesCount: 104,
    ratingAverage: 408, ratingCount: 41, weight: 4,
    specs: [V('3.3'), IFACE('I2C'), MOUNT('Through-hole'), spec('axes', 'Axes', '6')],
  },
  {
    sku: 'PIR-HC-SR501', slug: 'hc-sr501-pir-motion-sensor', name: 'HC-SR501 PIR Motion Sensor',
    shortDescription: 'Passive infrared presence detection with adjustable delay.',
    description: 'A pyroelectric sensor under a Fresnel lens, detecting a warm body up to 7 m away across a 110° cone. Two trimmers set sensitivity and how long the output stays high, so it needs no code beyond reading one pin.',
    categorySlug: 'motion-sensors', brandSlug: null,
    basePrice: 5500, salePrice: null, costPrice: 3400,
    onHand: 8, lowStockThreshold: 15, isFeatured: false, salesCount: 87,
    ratingAverage: 385, ratingCount: 28, weight: 6,
    specs: [V('5'), IFACE('GPIO'), MOUNT('Through-hole'), spec('range-distance', 'Detection Range', '3 to 7', 'm')],
  },
  {
    sku: 'RES-KIT-600', slug: 'resistor-kit-600-pieces', name: 'Resistor Kit — 600 Pieces, 30 Values',
    shortDescription: '1/4 W 1% metal film, 10 Ω to 1 MΩ, in a labelled box.',
    description: 'Thirty E12 values from 10 Ω to 1 MΩ, twenty of each, 1% metal film rather than the 5% carbon usually sold at this price. Supplied on labelled tape in a compartment box, which is the part that actually saves time.',
    categorySlug: 'resistors', brandSlug: null,
    basePrice: 15500, salePrice: null, costPrice: 9800,
    onHand: 44, lowStockThreshold: 10, isFeatured: false, salesCount: 58,
    ratingAverage: 472, ratingCount: 21, weight: 210,
    specs: [MOUNT('Through-hole'), spec('power-rating', 'Power Rating', '0.25', 'W'), spec('tolerance', 'Tolerance', '±1', '%'), spec('piece-count', 'Pieces', '600')],
  },
  {
    sku: 'RES-10K-1-4W', slug: 'resistor-10k-ohm-quarter-watt', name: 'Resistor 10 kΩ 1/4 W (each)',
    shortDescription: 'Single 1% metal film resistor, the default pull-up value.',
    description: 'A 10 kΩ 1% metal film resistor rated 1/4 W — the value you reach for as an I2C pull-up, a button pull-down or the top half of a divider. Sold individually.',
    categorySlug: 'resistors', brandSlug: null,
    basePrice: 100, salePrice: null, costPrice: 40,
    onHand: 4800, lowStockThreshold: 500, isFeatured: false, salesCount: 1240,
    ratingAverage: 430, ratingCount: 12, weight: 1,
    specs: [MOUNT('Through-hole'), spec('resistance', 'Resistance', '10', 'kΩ'), spec('power-rating', 'Power Rating', '0.25', 'W'), spec('tolerance', 'Tolerance', '±1', '%')],
  },
  {
    sku: 'CAP-ELEC-KIT', slug: 'electrolytic-capacitor-kit', name: 'Electrolytic Capacitor Kit — 120 Pieces',
    shortDescription: '0.1 µF to 1000 µF across 12 values, 16 V to 50 V.',
    description: 'Twelve values of radial aluminium electrolytic from 0.1 µF to 1000 µF, ten of each, rated 16 V to 50 V by value. Enough to decouple, smooth and time almost any hobby supply rail.',
    categorySlug: 'capacitors', brandSlug: null,
    basePrice: 18500, salePrice: 15900, costPrice: 11500,
    onHand: 27, lowStockThreshold: 8, isFeatured: false, salesCount: 39,
    ratingAverage: 440, ratingCount: 14, weight: 180,
    specs: [MOUNT('Through-hole'), spec('piece-count', 'Pieces', '120'), spec('voltage-rating', 'Voltage Rating', '16 to 50', 'V')],
  },
  {
    sku: 'CAP-CER-100NF', slug: 'ceramic-capacitor-100nf', name: 'Ceramic Capacitor 100 nF 50 V (each)',
    shortDescription: 'The decoupling capacitor. One per IC supply pin.',
    description: 'A 100 nF X7R multilayer ceramic rated 50 V — the capacitor that belongs across the supply pins of every integrated circuit on your board, as close to the pins as the layout allows.',
    categorySlug: 'capacitors', brandSlug: null,
    basePrice: 150, salePrice: null, costPrice: 60,
    onHand: 3200, lowStockThreshold: 400, isFeatured: false, salesCount: 980,
    ratingAverage: 425, ratingCount: 9, weight: 1,
    specs: [MOUNT('Through-hole'), spec('capacitance', 'Capacitance', '100', 'nF'), spec('voltage-rating', 'Voltage Rating', '50', 'V'), spec('dielectric', 'Dielectric', 'X7R')],
  },
  {
    sku: 'LIPO-3-7V-2000', slug: 'lipo-battery-3-7v-2000mah', name: 'LiPo Battery 3.7 V 2000 mAh',
    shortDescription: 'Single-cell lithium polymer with protection circuit and JST lead.',
    description: 'A 2000 mAh single-cell pouch with an integrated protection circuit against over-charge, over-discharge and short circuit, terminated in a JST-PH connector. Pairs directly with the TP4056 charger.',
    categorySlug: 'power', brandSlug: null,
    basePrice: 24500, salePrice: null, costPrice: 17000,
    onHand: 4, lowStockThreshold: 6, isFeatured: false, salesCount: 53,
    ratingAverage: 402, ratingCount: 18, weight: 38,
    specs: [V('3.7'), spec('capacity', 'Capacity', '2000', 'mAh'), spec('connector', 'Connector', 'JST-PH 2.0')],
  },
  {
    sku: 'TP4056-USB-C', slug: 'tp4056-charging-module-usb-c', name: 'TP4056 Li-Ion Charging Module (USB-C)',
    shortDescription: '1 A single-cell charger with protection, on USB-C.',
    description: 'A TP4056 constant-current/constant-voltage charger for a single lithium cell at up to 1 A, with a DW01 protection stage and a USB-C input rather than the micro-USB most of these still ship with.',
    categorySlug: 'power', brandSlug: null,
    basePrice: 3500, salePrice: null, costPrice: 1900,
    onHand: 178, lowStockThreshold: 25, isFeatured: false, salesCount: 231,
    ratingAverage: 415, ratingCount: 37, weight: 3,
    specs: [V('5'), IFACE('USB-C'), MOUNT('Through-hole'), spec('charge-current', 'Charge Current', '1', 'A')],
  },
  {
    sku: 'NRF24L01-PA-LNA', slug: 'nrf24l01-pa-lna-module', name: 'nRF24L01+ PA/LNA Module',
    shortDescription: '2.4 GHz transceiver with amplifier and antenna, ~1 km line of sight.',
    description: 'The nRF24L01+ with a power amplifier, low-noise amplifier and SMA antenna, pushing reliable range to roughly a kilometre in the open. Speaks SPI, and needs a well-decoupled 3.3 V rail to behave.',
    categorySlug: 'connectivity', brandSlug: 'nordic-semiconductor',
    basePrice: 16500, salePrice: null, costPrice: 11000,
    onHand: 39, lowStockThreshold: 10, isFeatured: false, salesCount: 72,
    ratingAverage: 392, ratingCount: 25, weight: 14,
    specs: [V('3.3'), CONN('2.4 GHz Radio'), IFACE('SPI'), MOUNT('Through-hole'), spec('range-distance', 'Range', '1000', 'm')],
  },
  {
    sku: 'SIM800L-GSM', slug: 'sim800l-gsm-module', name: 'SIM800L GSM/GPRS Module',
    shortDescription: 'Quad-band cellular for SMS and data where Wi-Fi cannot reach.',
    description: 'A quad-band GSM/GPRS module controlled by AT commands over UART, for SMS alerts and light data from sites with no Wi-Fi. Demands a supply that can deliver 2 A transient bursts — a USB port will not do it.',
    categorySlug: 'connectivity', brandSlug: null,
    basePrice: 34500, salePrice: null, costPrice: 25000,
    onHand: 0, lowStockThreshold: 8, isFeatured: false, salesCount: 44,
    ratingAverage: 360, ratingCount: 31, weight: 12,
    specs: [V('4'), CONN('GSM + GPRS'), IFACE('UART'), MOUNT('Through-hole')],
  },
  {
    sku: 'HAKKO-FX888D', slug: 'hakko-fx888d-soldering-station', name: 'Hakko FX-888D Soldering Station',
    shortDescription: '70 W digital station with fast recovery and a huge tip range.',
    description: 'The bench station most professionals settle on: 70 W, digital temperature control from 200 to 480 °C, and a ceramic heater that recovers fast enough to solder a ground plane without stalling. Tips are cheap and available everywhere.',
    categorySlug: 'tools', brandSlug: null,
    basePrice: 1450000, salePrice: null, costPrice: 1180000,
    onHand: 2, lowStockThreshold: 3, isFeatured: true, salesCount: 11,
    ratingAverage: 492, ratingCount: 13, weight: 2400,
    images: [
      image('hakko-fx888d-soldering-station', 1, 'Hakko FX-888D station and iron', 1600, 900),
    ],
    specs: [V('220'), spec('power-rating', 'Power', '70', 'W'), spec('range-temperature', 'Temperature Range', '200 to 480', '°C')],
  },
  {
    sku: 'DMM-UT61E', slug: 'uni-t-ut61e-multimeter', name: 'UNI-T UT61E Digital Multimeter',
    shortDescription: '22000-count true-RMS meter with PC logging.',
    description: 'A 22000-count true-RMS meter with 0.1% basic DC accuracy, frequency and duty-cycle measurement, and an optically isolated serial link for logging. Enough resolution to see the difference between two nominally identical resistors.',
    categorySlug: 'tools', brandSlug: null,
    basePrice: 289000, salePrice: 265000, costPrice: 224000,
    onHand: 6, lowStockThreshold: 3, isFeatured: false, salesCount: 19,
    ratingAverage: 458, ratingCount: 16, weight: 390,
    specs: [spec('display-count', 'Display Count', '22000'), spec('accuracy', 'Basic DC Accuracy', '±0.1', '%'), spec('true-rms', 'True RMS', 'Yes')],
  },
  // -------------------------------------------------------------------------
  // Added for Phase 4 (T1). Each one exists to make a rendering state
  // reachable that the original 26 could not produce; the comment on each says
  // which. They are ordinary catalogue rows in every other respect.
  // -------------------------------------------------------------------------
  {
    // THREE images and NO reviews: the gallery with a full thumbnail strip,
    // beside a rating widget that must render nothing rather than "0.0".
    sku: 'MPU9250-9DOF', slug: 'mpu9250-9-axis-imu', name: 'MPU-9250 9-Axis IMU',
    shortDescription: 'Accelerometer, gyroscope and magnetometer in one package.',
    description: 'Three sensors in one QFN: a 3-axis accelerometer, a 3-axis gyroscope and an AK8963 3-axis magnetometer, with an on-board digital motion processor that fuses them so the host does not have to. Speaks I2C or SPI at up to 20 MHz.',
    categorySlug: 'imu-modules', brandSlug: 'dfrobot',
    basePrice: 21500, salePrice: 18900, costPrice: 14000,
    onHand: 63, lowStockThreshold: 10, isFeatured: false, salesCount: 0,
    ratingAverage: 0, ratingCount: 0, weight: 4,
    images: [
      image('mpu9250-9-axis-imu', 1, 'MPU-9250 breakout, top view'),
      image('mpu9250-9-axis-imu', 2, 'MPU-9250 breakout, underside'),
      image('mpu9250-9-axis-imu', 3, 'MPU-9250 axis orientation diagram', 1600, 900),
    ],
    specs: [V('3.3'), IFACE('I2C / SPI'), MOUNT('Through-hole'), spec('axes', 'Axes', '9'), spec('gyro-range', 'Gyroscope Range', '±2000', '°/s')],
  },
  {
    // OUT OF STOCK, one image, no brand and no reviews — the combination a card
    // is most likely to get wrong, since three independent branches fire at once.
    sku: 'BNO055-BREAKOUT', slug: 'bno055-orientation-sensor', name: 'BNO055 Absolute Orientation Sensor',
    shortDescription: 'Sensor fusion in hardware — outputs quaternions directly.',
    description: 'The BNO055 runs the fusion algorithm on its own Cortex-M0, so it reports absolute orientation as Euler angles or quaternions without the host doing any maths. The reason it is worth more than the sum of its three sensors.',
    categorySlug: 'imu-modules', brandSlug: null,
    basePrice: 78000, salePrice: null, costPrice: 61000,
    onHand: 0, lowStockThreshold: 5, isFeatured: false, salesCount: 0,
    ratingAverage: 0, ratingCount: 0, weight: 5,
    images: [image('bno055-orientation-sensor', 1, 'BNO055 breakout board')],
    specs: [V('3.3'), IFACE('I2C / UART'), MOUNT('Through-hole'), spec('axes', 'Axes', '9'), spec('output', 'Output', 'Quaternion / Euler')],
  },
  {
    // FEATURED, on sale, three images: the home rail with everything switched on.
    sku: 'RPI-PICO-2W', slug: 'raspberry-pi-pico-2-w', name: 'Raspberry Pi Pico 2 W',
    shortDescription: 'RP2350 with Wi-Fi and Bluetooth, and twice the memory of the Pico W.',
    description: 'The RP2350 pairs dual Cortex-M33 cores with dual Hazard3 RISC-V cores — you choose which pair boots — alongside 520 KB of SRAM and the programmable IO blocks that made the original Pico worth having. Wi-Fi 4 and Bluetooth 5.2 are on board.',
    categorySlug: 'development-boards', brandSlug: 'raspberry-pi',
    basePrice: 42000, salePrice: 37500, costPrice: 29000,
    onHand: 88, lowStockThreshold: 15, isFeatured: true, salesCount: 96,
    ratingAverage: 478, ratingCount: 24, weight: 6,
    images: [
      image('raspberry-pi-pico-2-w', 1, 'Raspberry Pi Pico 2 W, top view'),
      image('raspberry-pi-pico-2-w', 2, 'Raspberry Pi Pico 2 W castellated edge', 1600, 900),
      image('raspberry-pi-pico-2-w', 3, 'Raspberry Pi Pico 2 W beside a coin for scale'),
    ],
    specs: [V('3.3'), CONN('Wi-Fi + Bluetooth'), IFACE('USB-C'), MOUNT('Through-hole / SMD'), spec('cpu-cores', 'CPU Cores', '2'), spec('sram', 'SRAM', '520', 'KB')],
  },
  {
    // A SECOND product for a brand that had only one, so a brand page shows a
    // grid rather than a single card.
    sku: 'WS-RP2040-ZERO', slug: 'waveshare-rp2040-zero', name: 'Waveshare RP2040-Zero',
    shortDescription: 'Thumb-sized RP2040 board with castellated edges for direct soldering.',
    description: 'An RP2040 in a footprint smaller than a postage stamp, with castellated edges so it can be reflowed onto a carrier board like a module. USB-C, 2 MB of flash and 29 GPIO, of which 20 are broken out.',
    categorySlug: 'development-boards', brandSlug: 'waveshare',
    basePrice: 18500, salePrice: null, costPrice: 13000,
    onHand: 4, lowStockThreshold: 10, isFeatured: false, salesCount: 33,
    ratingAverage: 441, ratingCount: 9, weight: 2,
    images: [
      image('waveshare-rp2040-zero', 1, 'Waveshare RP2040-Zero, top view'),
      image('waveshare-rp2040-zero', 2, 'Waveshare RP2040-Zero castellated edges'),
    ],
    specs: [V('3.3'), IFACE('USB-C'), MOUNT('Through-hole / SMD'), spec('flash', 'Flash', '2', 'MB')],
  },
  {
    // No images, no brand, plenty of stock: the majority state, and the one the
    // placeholder path has to keep handling after the migration.
    sku: 'LORA-SX1278-433', slug: 'lora-sx1278-433mhz-module', name: 'LoRa SX1278 433 MHz Module',
    shortDescription: 'Long-range sub-GHz radio with a 3 km line-of-sight link budget.',
    description: 'Semtech SX1278 spread-spectrum radio on the 433 MHz ISM band, reaching several kilometres line-of-sight at low data rates. SPI interface, adjustable spreading factor, and an antenna connection you actually have to think about.',
    categorySlug: 'connectivity', brandSlug: null,
    basePrice: 26000, salePrice: 22500, costPrice: 17500,
    onHand: 71, lowStockThreshold: 12, isFeatured: false, salesCount: 27,
    ratingAverage: 415, ratingCount: 11, weight: 7,
    specs: [V('3.3'), CONN('LoRa 433 MHz'), IFACE('SPI'), MOUNT('Through-hole'), spec('range', 'Line-of-sight Range', '3', 'km')],
  },
  {
    // A THIRD Arduino-branded board, so brand faceting has a bucket big enough
    // to be worth filtering by.
    sku: 'ARDUINO-NANO-33-BLE', slug: 'arduino-nano-33-ble-sense', name: 'Arduino Nano 33 BLE Sense',
    shortDescription: 'Nano footprint with BLE, an IMU and four environmental sensors.',
    description: 'An nRF52840 in the Nano footprint, with Bluetooth Low Energy, a 9-axis IMU, and sensors for temperature, humidity, pressure, light, gesture and sound. The board Arduino ships its machine-learning tutorials against.',
    categorySlug: 'development-boards', brandSlug: 'arduino',
    basePrice: 145000, salePrice: null, costPrice: 112000,
    onHand: 17, lowStockThreshold: 5, isFeatured: true, salesCount: 41,
    ratingAverage: 462, ratingCount: 22, weight: 12,
    images: [
      image('arduino-nano-33-ble-sense', 1, 'Arduino Nano 33 BLE Sense, top view'),
      image('arduino-nano-33-ble-sense', 2, 'Arduino Nano 33 BLE Sense sensor cluster', 1600, 900),
      image('arduino-nano-33-ble-sense', 3, 'Arduino Nano 33 BLE Sense, underside'),
    ],
    specs: [V('3.3'), CONN('Bluetooth LE'), IFACE('Micro USB'), MOUNT('Through-hole'), spec('cpu-cores', 'CPU Cores', '1'), spec('sensors', 'On-board Sensors', '6')],
  },
  {
    // The cheapest row in the catalogue after the single resistor, and the only
    // one with a single image in a category that otherwise has none.
    sku: 'RES-KIT-PRECISION', slug: 'precision-resistor-kit-1-percent', name: 'Precision Resistor Kit — 1%, 20 Values',
    shortDescription: '1% metal-film resistors, 20 values, 20 of each.',
    description: 'Metal-film resistors at 1% tolerance and 50 ppm/°C, in the twenty values that actually turn up in analogue front ends. Sorted into a labelled box rather than a bag, because finding a 4.99 kΩ in a bag is not a design activity.',
    categorySlug: 'resistors', brandSlug: null,
    basePrice: 9500, salePrice: null, costPrice: 6200,
    onHand: 34, lowStockThreshold: 8, isFeatured: false, salesCount: 15,
    ratingAverage: 430, ratingCount: 6, weight: 180,
    images: [image('precision-resistor-kit-1-percent', 1, 'Precision resistor kit in its labelled box', 1600, 900)],
    specs: [MOUNT('Through-hole'), spec('tolerance', 'Tolerance', '±1', '%'), spec('power-rating', 'Power', '0.25', 'W'), spec('piece-count', 'Pieces', '400')],
  },
  {
    // Low stock AND on sale AND no images: the badge combination on a card that
    // has nothing else to show.
    sku: 'USB-LOGIC-8CH', slug: 'usb-logic-analyser-8-channel', name: 'USB Logic Analyser — 8 Channel, 24 MHz',
    shortDescription: 'Eight channels at 24 MS/s, driven by sigrok or PulseView.',
    description: 'Eight channels sampling at up to 24 MS/s over USB, which is enough to decode I2C, SPI and UART traffic on any of the boards in this catalogue. Works with sigrok and PulseView, so no vendor software is required.',
    categorySlug: 'tools', brandSlug: null,
    basePrice: 47000, salePrice: 39000, costPrice: 31000,
    onHand: 3, lowStockThreshold: 6, isFeatured: false, salesCount: 52,
    ratingAverage: 447, ratingCount: 29, weight: 60,
    specs: [V('5'), IFACE('USB'), spec('channels', 'Channels', '8'), spec('sample-rate', 'Sample Rate', '24', 'MS/s')],
  },
];
