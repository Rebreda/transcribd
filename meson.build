project(
  'transcribd',
  version: '1.0.0',
  license: 'GPL2+',
  meson_version: '>= 0.63.0',
)


if get_option('profile') == 'development'
  profile = '.Devel'
  name_suffix = ' (Development)'
  vcs_tag = run_command('git', 'rev-parse', '--short', 'HEAD', check: true).stdout().strip()
  if vcs_tag == ''
    version_suffix = '-devel'
  else
    version_suffix = '-@0@'.format (vcs_tag)
  endif
else
  profile = ''
  name_suffix = ''
  version_suffix = ''
endif

application_id = 'io.github.rebreda.Transcribd@0@'.format(profile)

gettext_package = application_id
transcribd_prefix = get_option('prefix')
transcribd_bindir = transcribd_prefix / get_option('bindir')
transcribd_libdir = transcribd_prefix / get_option('libdir')
transcribd_datadir = transcribd_prefix / get_option('datadir')
transcribd_pkgdatadir = transcribd_datadir / application_id

transcribd_schemadir = transcribd_datadir / 'glib-2.0' / 'schemas'

po_dir = meson.project_source_root() / 'po'

gjs_dep = dependency('gjs-1.0', version: '>= 1.54.0')
gjs_console = gjs_dep.get_variable(pkgconfig: 'gjs_console')

# Lets check whether the dependencies exist
dependency('gio-2.0', version: '>= 2.43.4')
dependency('glib-2.0', version: '>= 2.39.3')
dependency('gtk4', version: '>= 4.15.2')
dependency('gst-player-1.0', version: '>= 1.12', required: false)
dependency('libadwaita-1', version: '>= 1.6.alpha')
dependency('gobject-introspection-1.0', version: '>= 1.31.6')
dependency('gstreamer-1.0')
dependency('gstreamer-pbutils-1.0')


gnome = import('gnome')
i18n = import('i18n')

tsc = find_program('tsc', dirs: [meson.project_source_root() / 'node_modules' / '.bin'], required: true)

subdir('data')
subdir('src')
subdir('po')


install_symlink(
  meson.project_name(),
  pointing_to: transcribd_pkgdatadir / application_id,
  install_dir: transcribd_bindir
)

gnome.post_install(
  glib_compile_schemas: true,
  gtk_update_icon_cache: true,
  update_desktop_database: true,
)