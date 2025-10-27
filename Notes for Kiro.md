Notes for Kiro
Difficult to tell what file is not yet saved.

Adding images to the chat attaches them as "full" size thumbnails making it quite difficult to tell which images have been added.

Kiro does not always acknowledge the attached images, or incorrectly assumes they are what we want instead of confirming with our messages

Creating way too many documentation files. Each change or fix comes with it's own .md file detailing what has been edited. Would make more sense to commit the changes to github or other git tools instead of the .md files. Sometimes these files get interpreted as correct while many changes have happened in-between.

A lot of times in vibe mode we need to pivot since the results we are getting are not what we wanted. When we pivot all the previous files we created are still in the project and still get referenced. These should probably go into a bucket or trash folder so we maintain a clean codebase. I've had to personally do cleanup of old unused code many times throughout the project.

In spec mode Kiro would sometimes implement more in a task meaning when we progressed through the tasklist it would have to redo previously implemented tasks making the result worse than what it created before. With tasks it should correctly evaluate what has been done already, compare it to the task at hand, recognize what still needs to be implemented, suggest or ask for confirmation/guidance and then implement.
