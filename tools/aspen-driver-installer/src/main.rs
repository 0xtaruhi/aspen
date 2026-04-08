use std::process;

#[cfg(target_os = "windows")]
use std::{
    env, fs,
    path::{Path, PathBuf},
};

#[cfg(target_os = "windows")]
const DEFAULT_VENDOR_ID: u16 = 0x2200;
#[cfg(target_os = "windows")]
const DEFAULT_PRODUCT_ID: u16 = 0x2008;
#[cfg(target_os = "windows")]
const DEFAULT_INTERFACE_ID: u8 = 0;
#[cfg(target_os = "windows")]
const DEFAULT_DEVICE_NAME: &str = "VLFD FPGA board (FDP3P7)";
#[cfg(target_os = "windows")]
const DEFAULT_VENDOR_NAME: &str = "Aspen";
#[cfg(target_os = "windows")]
const DEFAULT_INF_NAME: &str = "aspen-winusb.inf";

#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("aspen-driver-installer is only supported on Windows");
    process::exit(1);
}

#[cfg(target_os = "windows")]
fn main() {
    match run() {
        Ok(code) => process::exit(code),
        Err(err) => {
            eprintln!("{err}");
            process::exit(1);
        }
    }
}

#[cfg(target_os = "windows")]
fn run() -> Result<i32, String> {
    let options = Options::parse(env::args().skip(1))?;

    if options.help {
        print_help();
        return Ok(0);
    }

    let package_dir = options
        .dest
        .clone()
        .unwrap_or(default_package_dir().map_err(|err| err.to_string())?);
    fs::create_dir_all(&package_dir).map_err(|err| {
        format!(
            "failed to create driver package directory '{}': {err}",
            package_dir.display()
        )
    })?;

    let mut device = device_template(options.vendor_id, options.product_id, options.interface_id);
    if let Some(plugged) = find_connected_device(&device)? {
        device.hardware_id = plugged.hardware_id;
        device.device_id = plugged.device_id;
    }

    let mut prepare_options = wdi_rs::PrepareDriverOptions::default();
    prepare_options.driver_type = wdi_rs::DriverType::WinUsb;
    prepare_options.vendor_name = Some(DEFAULT_VENDOR_NAME.to_string());

    let install_options = wdi_rs::InstallDriverOptions {
        pending_install_timeout: options.pending_install_timeout_ms,
        ..Default::default()
    };

    let package_dir_str = package_dir.to_string_lossy().to_string();
    wdi_rs::set_log_level(if options.quiet {
        wdi_rs::LogLevel::None
    } else {
        wdi_rs::LogLevel::Warning
    })
    .map_err(format_wdi_error)?;

    if !options.quiet {
        println!(
            "Preparing Aspen WinUSB driver files in {}",
            package_dir.display()
        );
    }

    wdi_rs::prepare_driver(
        &device,
        &package_dir_str,
        DEFAULT_INF_NAME,
        &prepare_options,
    )
    .map_err(format_wdi_error)?;

    if !options.install {
        return Ok(0);
    }

    if !options.quiet {
        println!("Installing Aspen WinUSB driver package");
    }

    match wdi_rs::install_driver(
        &device,
        &package_dir_str,
        DEFAULT_INF_NAME,
        &install_options,
    ) {
        Ok(()) | Err(wdi_rs::Error::Exists) => Ok(0),
        Err(err) => Err(format_wdi_error(err)),
    }
}

#[cfg(target_os = "windows")]
fn default_package_dir() -> Result<PathBuf, std::io::Error> {
    let exe = env::current_exe()?;
    let parent = exe.parent().unwrap_or_else(|| Path::new("."));
    Ok(parent.join("driver-package"))
}

#[cfg(target_os = "windows")]
fn device_template(vendor_id: u16, product_id: u16, interface_id: u8) -> wdi_rs::Device {
    wdi_rs::Device {
        vid: vendor_id,
        pid: product_id,
        is_composite: true,
        mi: interface_id,
        desc: Some(DEFAULT_DEVICE_NAME.to_string()),
        driver: None,
        device_id: None,
        hardware_id: None,
        compatible_id: None,
        upper_filter: None,
        driver_version: 0,
    }
}

#[cfg(target_os = "windows")]
fn find_connected_device(target: &wdi_rs::Device) -> Result<Option<wdi_rs::Device>, String> {
    let devices = wdi_rs::create_list(wdi_rs::CreateListOptions {
        list_all: true,
        list_hubs: true,
        trim_whitespaces: true,
    })
    .map_err(format_wdi_error)?;

    Ok(devices.iter().find(|device| {
        device.vid == target.vid
            && device.pid == target.pid
            && device.is_composite == target.is_composite
            && device.mi == target.mi
    }))
}

#[cfg(target_os = "windows")]
fn format_wdi_error(error: wdi_rs::Error) -> String {
    match error {
        wdi_rs::Error::NeedsAdmin => {
            "WinUSB installation requires administrator privileges".to_string()
        }
        other => format!("WinUSB installation failed: {other}"),
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
struct Options {
    install: bool,
    quiet: bool,
    help: bool,
    vendor_id: u16,
    product_id: u16,
    interface_id: u8,
    pending_install_timeout_ms: u32,
    dest: Option<PathBuf>,
}

#[cfg(target_os = "windows")]
impl Default for Options {
    fn default() -> Self {
        Self {
            install: false,
            quiet: false,
            help: false,
            vendor_id: DEFAULT_VENDOR_ID,
            product_id: DEFAULT_PRODUCT_ID,
            interface_id: DEFAULT_INTERFACE_ID,
            pending_install_timeout_ms: 120_000,
            dest: None,
        }
    }
}

#[cfg(target_os = "windows")]
impl Options {
    fn parse<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut options = Self::default();
        let mut iter = args.into_iter();

        while let Some(arg) = iter.next() {
            match arg.as_str() {
                "--install" => options.install = true,
                "--quiet" | "--silent" => options.quiet = true,
                "--help" | "-h" => options.help = true,
                "--vid" => {
                    options.vendor_id = parse_u16(&next_value(&mut iter, "--vid")?, "vendor id")?;
                }
                "--pid" => {
                    options.product_id = parse_u16(&next_value(&mut iter, "--pid")?, "product id")?;
                }
                "--mi" | "--iid" => {
                    options.interface_id =
                        parse_u8(&next_value(&mut iter, "--mi")?, "interface id")?;
                }
                "--timeout" => {
                    options.pending_install_timeout_ms =
                        parse_u32(&next_value(&mut iter, "--timeout")?, "timeout")?;
                }
                "--dest" => {
                    options.dest = Some(PathBuf::from(next_value(&mut iter, "--dest")?));
                }
                other => return Err(format!("unknown option '{other}'")),
            }
        }

        Ok(options)
    }
}

#[cfg(target_os = "windows")]
fn next_value<I>(iter: &mut I, flag: &str) -> Result<String, String>
where
    I: Iterator<Item = String>,
{
    iter.next()
        .ok_or_else(|| format!("missing value for {flag}"))
}

#[cfg(target_os = "windows")]
fn parse_u16(value: &str, label: &str) -> Result<u16, String> {
    parse_u32(value, label)?
        .try_into()
        .map_err(|_| format!("invalid {label}: {value}"))
}

#[cfg(target_os = "windows")]
fn parse_u8(value: &str, label: &str) -> Result<u8, String> {
    parse_u32(value, label)?
        .try_into()
        .map_err(|_| format!("invalid {label}: {value}"))
}

#[cfg(target_os = "windows")]
fn parse_u32(value: &str, label: &str) -> Result<u32, String> {
    let trimmed = value.trim();
    if let Some(hex) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        return u32::from_str_radix(hex, 16).map_err(|_| format!("invalid {label}: {value}"));
    }

    trimmed
        .parse::<u32>()
        .map_err(|_| format!("invalid {label}: {value}"))
}

#[cfg(target_os = "windows")]
fn print_help() {
    println!("Aspen WinUSB driver installer");
    println!("  --install          prepare and install the driver package");
    println!("  --quiet            suppress helper output");
    println!("  --vid <id>         set the USB vendor id (default 0x2200)");
    println!("  --pid <id>         set the USB product id (default 0x2008)");
    println!("  --mi <id>          set the composite interface id (default 0)");
    println!("  --timeout <ms>     wait for pending installs (default 120000)");
    println!("  --dest <dir>       keep generated driver files under this directory");
}
