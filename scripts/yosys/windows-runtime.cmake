# Injected through CMAKE_PROJECT_yosys_INCLUDE, without patching upstream sources.
if(NOT WIN32)
  return()
endif()
enable_language(RC)

function(aspen_yosys_windows_runtime)
  set(ASPEN_YOSYS_MANIFEST "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/windows-utf8.manifest")
  set(resource "${CMAKE_CURRENT_BINARY_DIR}/aspen-yosys-utf8.rc")
  configure_file("${CMAKE_CURRENT_FUNCTION_LIST_DIR}/windows-utf8.rc.in" "${resource}" @ONLY)
  set_source_files_properties("${resource}" PROPERTIES OBJECT_DEPENDS "${ASPEN_YOSYS_MANIFEST}")
  foreach(executable yosys yosys-abc)
    if(NOT TARGET ${executable})
      message(FATAL_ERROR "Missing Yosys runtime target: ${executable}")
    endif()
    target_sources(${executable} PRIVATE "${resource}")
  endforeach()
endfunction()

# project() runs before the executable targets have been declared.
cmake_language(DEFER CALL aspen_yosys_windows_runtime)
